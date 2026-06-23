const { PrismaClient } = require('@prisma/client');
const { validateGatewayCredentials, PIX_GATEWAY_SLUGS } = require('../services/gatewayValidation.service');

const prisma = new PrismaClient();

const PIX_SLUGS = [...PIX_GATEWAY_SLUGS, 'efi-pix'];

class GatewayController {
  async list(req, res) {
    try {
      const gateways = await prisma.gatewayConfig.findMany({
        orderBy: { name: 'asc' },
      });
      return res.json({ gateways });
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

      const result = await validateGatewayCredentials(slug, config);
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

      if (config && !skipValidation) {
        const validation = await validateGatewayCredentials(slug, config);
        if (!validation.valid) {
          return res.status(400).json({ error: validation.message });
        }
      }

      const gateway = await prisma.gatewayConfig.upsert({
        where: { slug },
        update: {
          name,
          config,
          ...(isActive !== undefined ? { isActive } : {}),
        },
        create: {
          slug,
          name,
          config,
          isActive: isActive ?? false,
        },
      });

      return res.json(gateway);
    } catch (err) {
      console.error('[Gateway.update]', err);
      return res.status(500).json({ error: 'Erro ao atualizar gateway' });
    }
  }

  async toggle(req, res) {
    try {
      const { slug } = req.params;
      const { isActive } = req.body;

      if (isActive && PIX_SLUGS.includes(slug)) {
        await prisma.gatewayConfig.updateMany({
          where: {
            isActive: true,
            slug: { in: PIX_SLUGS.filter((s) => s !== slug) },
          },
          data: { isActive: false },
        });
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

      return res.json(gateway);
    } catch (err) {
      console.error('[Gateway.toggle]', err);
      return res.status(500).json({ error: 'Erro ao alternar status do gateway' });
    }
  }
}

module.exports = new GatewayController();
