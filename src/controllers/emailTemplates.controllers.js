const { prisma } = require('../config/prisma');
const emailService = require('../services/email.service');
const {
  normalizeEmailTemplates,
  EMAIL_BLOCK_CATALOG,
  SAMPLE_BODY_HTML,
  DEFAULT_HEADER_HTML,
  DEFAULT_FOOTER_HTML,
  DEFAULT_BODIES,
  buildEmailDocument,
  getEmailTemplates,
} = require('../utils/emailTemplatesSettings');

function defaultsPayload() {
  return {
    headerHtml: DEFAULT_HEADER_HTML,
    footerHtml: DEFAULT_FOOTER_HTML,
    sampleBodyHtml: SAMPLE_BODY_HTML,
    bodies: DEFAULT_BODIES,
  };
}

function buildPreviewVars(branding, body = {}) {
  const sampleItems = `<table style="width:100%;border-collapse:collapse;"><tr>
    <td style="vertical-align:middle;text-align:left;padding:6px 0;">
      <h3 style="margin:0;font-size:17px;color:#ffffff;font-weight:600;">Produto de exemplo</h3>
      <p style="margin:4px 0 0;font-size:18px;color:#A855F7;font-weight:700;">R$&nbsp;69,99</p>
      <p style="margin:2px 0 0;color:#a1a1aa;font-size:13px;">1x</p>
    </td>
  </tr></table>`;

  return {
    storeName: branding.storeName,
    logoUrl: branding.logoUrl,
    logoWhiteUrl: branding.logoWhiteUrl,
    storeUrl: branding.storeUrl,
    contactEmail: branding.contactEmail,
    contactPhone: branding.contactPhone,
    year: branding.year,
    customerName: branding.customerName || 'Cliente',
    orderId: 'SP-1024',
    itemsHtml: sampleItems,
    totalLabel: 'R$ 69,99',
    paymentExpiresLabel: '19/07/2026 23:59',
    copyPaste: '00020126580014BR.GOV.BCB.PIX...',
    couponCode: 'SPACE10',
    reason: 'Pagamento não identificado',
    ctaUrl: branding.ctaUrl || branding.storeUrl,
    ctaLabel: body.ctaLabel || branding.ctaLabel || 'Abrir loja',
    unsubscribeUrl: branding.unsubscribeUrl || '#',
    title: body.title || 'Pré-visualização',
    subtitle: body.subtitle || 'Como o e-mail aparece para o cliente',
  };
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

class EmailTemplatesController {
  async get(req, res) {
    try {
      const { templates, branding } = await getEmailTemplates(prisma);
      return res.json({
        templates,
        branding,
        catalog: EMAIL_BLOCK_CATALOG,
        defaults: defaultsPayload(),
      });
    } catch (err) {
      console.error('[EmailTemplates.get]', err);
      return res.status(500).json({ error: 'Erro ao carregar templates de e-mail' });
    }
  }

  async update(req, res) {
    try {
      const body = req.body ?? {};
      const current = await prisma.siteConfig.findUnique({
        where: { id: 'default' },
        select: { emailTemplates: true },
      });

      const merged = normalizeEmailTemplates({
        ...(current?.emailTemplates && typeof current.emailTemplates === 'object'
          ? current.emailTemplates
          : {}),
        ...(body.headerHtml !== undefined ? { headerHtml: String(body.headerHtml) } : {}),
        ...(body.footerHtml !== undefined ? { footerHtml: String(body.footerHtml) } : {}),
        ...(body.bodies !== undefined ? { bodies: body.bodies } : {}),
        ...(body.subjects !== undefined ? { subjects: body.subjects } : {}),
      });

      if (merged.headerHtml.length > 100000 || merged.footerHtml.length > 100000) {
        return res.status(400).json({ error: 'HTML do cabeçalho/rodapé muito grande' });
      }
      for (const [key, value] of Object.entries(merged.bodies || {})) {
        if (typeof value === 'string' && value.length > 100000) {
          return res.status(400).json({ error: `Corpo do e-mail "${key}" muito grande` });
        }
      }

      await prisma.siteConfig.upsert({
        where: { id: 'default' },
        create: { id: 'default', emailTemplates: merged },
        update: { emailTemplates: merged },
      });

      const { templates, branding } = await getEmailTemplates(prisma);
      return res.json({
        templates,
        branding,
        catalog: EMAIL_BLOCK_CATALOG,
        defaults: defaultsPayload(),
      });
    } catch (err) {
      console.error('[EmailTemplates.update]', err);
      return res.status(500).json({ error: 'Erro ao salvar templates de e-mail' });
    }
  }

  async preview(req, res) {
    try {
      const { templates, branding } = await getEmailTemplates(prisma);
      const body = req.body ?? {};

      const headerHtml =
        typeof body.headerHtml === 'string' ? body.headerHtml : templates.headerHtml;
      const footerHtml =
        typeof body.footerHtml === 'string' ? body.footerHtml : templates.footerHtml;
      const bodyHtml =
        typeof body.bodyHtml === 'string' && body.bodyHtml.trim()
          ? body.bodyHtml
          : SAMPLE_BODY_HTML;

      const vars = buildPreviewVars(branding, body);
      const html = buildEmailDocument({ headerHtml, footerHtml, bodyHtml, vars });
      return res.json({ html });
    } catch (err) {
      console.error('[EmailTemplates.preview]', err);
      return res.status(500).json({ error: 'Erro ao gerar pré-visualização' });
    }
  }

  async sendTest(req, res) {
    try {
      const body = req.body ?? {};
      const to = String(body.to || '').trim();
      if (!isValidEmail(to)) {
        return res.status(400).json({ error: 'Informe um e-mail válido para o teste' });
      }
      if (!emailService.isConfigured()) {
        return res.status(503).json({
          error: 'SMTP não configurado. Configure SMTP_USER e SMTP_PASS no servidor.',
        });
      }

      const { templates, branding } = await getEmailTemplates(prisma);
      const headerHtml =
        typeof body.headerHtml === 'string' ? body.headerHtml : templates.headerHtml;
      const footerHtml =
        typeof body.footerHtml === 'string' ? body.footerHtml : templates.footerHtml;
      const bodyHtml =
        typeof body.bodyHtml === 'string' && body.bodyHtml.trim()
          ? body.bodyHtml
          : SAMPLE_BODY_HTML;

      const vars = buildPreviewVars(branding, body);
      const html = buildEmailDocument({ headerHtml, footerHtml, bodyHtml, vars });
      const blockLabel = body.blockId || body.title || 'template';
      const subject = `[TESTE] ${branding.storeName} — ${vars.title || blockLabel}`;

      const sent = await emailService.sendEmail(to, subject, html);
      if (!sent) {
        return res.status(500).json({ error: 'Falha ao enviar e-mail de teste' });
      }

      return res.json({ success: true, to, subject });
    } catch (err) {
      console.error('[EmailTemplates.sendTest]', err);
      return res.status(500).json({ error: 'Erro ao enviar e-mail de teste' });
    }
  }
}

module.exports = new EmailTemplatesController();
