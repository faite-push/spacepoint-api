const { prisma } = require('../config/prisma');
const { validateGatewayCredentials } = require('../services/gatewayValidation.service');
const {
  getSupportedMethods,
  supportsMethod,
  getGatewayActiveMethods,
  hasAnyActiveMethod,
} = require('../config/gatewayCapabilities');
const {
  recordAdminAction,
  AUDIT_ACTIONS,
  requestContext,
} = require('../services/auditLog.service');
const {
  prepareGatewayConfigForStorage,
  redactGatewayConfigForClient,
  unlockGatewayConfig,
} = require('../utils/gatewaySecrets');

function hasSharedWebhookEnv() {
  return Boolean(String(process.env.WEBHOOK_SHARED_SECRET || '').trim());
}

function buildActiveMethodsFromLegacy(gateway) {
  const supported = getSupportedMethods(gateway.slug);
  const legacy = Array.isArray(gateway.config?.paymentMethods)
    ? gateway.config.paymentMethods.map((m) => String(m).toUpperCase())
    : [];

  if (gateway.isActive && legacy.length) {
    return {
      PIX: supported.includes('PIX') && legacy.includes('PIX'),
      CARD: supported.includes('CARD') && legacy.includes('CARD'),
    };
  }

  return getGatewayActiveMethods(gateway);
}

function mergeConfigWithActiveMethods(config, activeMethods) {
  const paymentMethods = [];
  if (activeMethods.PIX) paymentMethods.push('PIX');
  if (activeMethods.CARD) paymentMethods.push('CARD');

  return {
    ...(config || {}),
    activeMethods,
    paymentMethods,
  };
}

function sanitizeGatewayResponse(gateway) {
  if (!gateway) return gateway;
  return {
    ...gateway,
    config: redactGatewayConfigForClient(gateway.config),
  };
}

/** Mescla placeholder __STORED__ com cert do banco e descriptografa para validação. */
function resolveConfigForValidation(slug, incomingConfig, existingConfig) {
  const prepared = prepareGatewayConfigForStorage(incomingConfig, existingConfig || {});
  return unlockGatewayConfig(prepared);
}

function assertWebhookSecretIfActivating(slug, config, isActive, activeMethods) {
  const gatewaysWithWebhook = new Set(['efi-bank', 'pagbank', 'stripe', 'mercado-pago']);
  if (!gatewaysWithWebhook.has(slug)) return null;

  const activating = isActive || activeMethods?.PIX || activeMethods?.CARD;
  if (!activating) return null;

  if (!hasSharedWebhookEnv()) {
    return 'Configure WEBHOOK_SHARED_SECRET no .env da API antes de ativar este gateway.';
  }
  return null;
}

class GatewayController {
  async list(req, res) {
    try {
      const gateways = await prisma.gatewayConfig.findMany({
        orderBy: { name: 'asc' },
      });
      return res.json({ gateways: gateways.map(sanitizeGatewayResponse) });
    } catch (err) {
      console.error('[Gateway.list]', err);
      return res.status(500).json({ error: 'Erro ao listar gateways' });
    }
  }

  async validate(req, res) {
    try {
      const { slug } = req.params;
      const { config } = req.body;

      if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'Configuração inválida' });
      }

      const existing = await prisma.gatewayConfig.findUnique({ where: { slug } });
      const unlocked = resolveConfigForValidation(slug, config, existing?.config);

      const result = await validateGatewayCredentials(slug, unlocked);
      if (!result.valid) {
        return res.status(400).json({
          valid: false,
          error: result.message,
          enforceSandbox: result.enforceSandbox === true,
        });
      }

      return res.json({
        valid: true,
        message: result.message,
        enforceSandbox: result.enforceSandbox === true,
      });
    } catch (err) {
      console.error('[Gateway.validate]', err);
      return res.status(500).json({ error: 'Erro ao validar credenciais' });
    }
  }

  async update(req, res) {
    try {
      const { slug } = req.params;
      const { name, config, isActive, skipValidation } = req.body;

      const existing = await prisma.gatewayConfig.findUnique({ where: { slug } });
      const storedConfig = config
        ? prepareGatewayConfigForStorage(config, existing?.config || {})
        : existing?.config;

      if (config && !skipValidation) {
        const unlocked = unlockGatewayConfig(storedConfig);
        const validation = await validateGatewayCredentials(slug, unlocked);
        if (!validation.valid) {
          return res.status(400).json({ error: validation.message });
        }
      }

      const gateway = await prisma.gatewayConfig.upsert({
        where: { slug },
        update: {
          name,
          ...(storedConfig ? { config: storedConfig } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
        create: {
          slug,
          name,
          config: storedConfig || {},
          isActive: isActive ?? false,
        },
      });

      await recordAdminAction({
        ...requestContext(req),
        action: AUDIT_ACTIONS.GATEWAY_UPDATE,
        targetType: 'gateway',
        targetId: slug,
        metadata: {
          gatewayName: gateway.name || slug,
          oldActive: existing?.isActive ?? null,
          newActive: gateway.isActive,
          configUpdated: Boolean(config),
        },
      });

      return res.json(sanitizeGatewayResponse(gateway));
    } catch (err) {
      console.error('[Gateway.update]', err);
      return res.status(500).json({ error: 'Erro ao atualizar gateway' });
    }
  }

  async toggle(req, res) {
    try {
      const { slug } = req.params;
      const { isActive } = req.body;

      if (isActive) {
        const existing = await prisma.gatewayConfig.findUnique({ where: { slug } });
        const secretErr = assertWebhookSecretIfActivating(slug, existing?.config, true, existing?.config?.activeMethods);
        if (secretErr) {
          return res.status(400).json({ error: secretErr });
        }
      }

      const gateway = await prisma.gatewayConfig.upsert({
        where: { slug },
        update: { isActive },
        create: {
          slug,
          name: slug,
          config: {},
          isActive,
        },
      });

      await recordAdminAction({
        ...requestContext(req),
        action: AUDIT_ACTIONS.GATEWAY_UPDATE,
        targetType: 'gateway',
        targetId: slug,
        metadata: {
          gatewayName: gateway.name || slug,
          newActive: gateway.isActive,
          toggled: true,
        },
      });

      return res.json(sanitizeGatewayResponse(gateway));
    } catch (err) {
      console.error('[Gateway.toggle]', err);
      return res.status(500).json({ error: 'Erro ao alternar status do gateway' });
    }
  }

  async toggleMethod(req, res) {
    try {
      const { slug } = req.params;
      const method = String(req.body?.method || '').trim().toUpperCase();
      const enabled = Boolean(req.body?.enabled);

      if (!['PIX', 'CARD'].includes(method)) {
        return res.status(400).json({ error: 'Método inválido' });
      }

      if (!supportsMethod(slug, method)) {
        return res.status(400).json({ error: `${method} não é suportado por este gateway` });
      }

      const existing = await prisma.gatewayConfig.findUnique({ where: { slug } });
      if (!existing) {
        return res.status(404).json({ error: 'Gateway não encontrado' });
      }

      if (enabled) {
        const nextPreview = { ...buildActiveMethodsFromLegacy(existing), [method]: true };
        const secretErr = assertWebhookSecretIfActivating(slug, existing.config, true, nextPreview);
        if (secretErr) {
          return res.status(400).json({ error: secretErr });
        }
      }

      const currentActive = buildActiveMethodsFromLegacy(existing);
      const nextActive = {
        ...currentActive,
        [method]: enabled,
      };

      if (enabled) {
        const allGateways = await prisma.gatewayConfig.findMany();
        await Promise.all(
          allGateways
            .filter((gw) => gw.slug !== slug && supportsMethod(gw.slug, method))
            .map(async (gw) => {
              const gwActive = buildActiveMethodsFromLegacy(gw);
              if (!gwActive[method]) return null;

              const updatedMethods = { ...gwActive, [method]: false };
              return prisma.gatewayConfig.update({
                where: { id: gw.id },
                data: {
                  config: mergeConfigWithActiveMethods(gw.config, updatedMethods),
                  isActive: hasAnyActiveMethod({ config: { activeMethods: updatedMethods } }),
                },
              });
            })
        );
      }

      const updated = await prisma.gatewayConfig.update({
        where: { slug },
        data: {
          config: mergeConfigWithActiveMethods(existing.config, nextActive),
          isActive: hasAnyActiveMethod({ config: { activeMethods: nextActive } }),
        },
      });

      return res.json(sanitizeGatewayResponse(updated));
    } catch (err) {
      console.error('[Gateway.toggleMethod]', err);
      return res.status(500).json({ error: 'Erro ao alternar método do gateway' });
    }
  }
}

module.exports = new GatewayController();
