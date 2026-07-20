const emailService = require('../services/email.service');
const {
  buildEmailDocument,
  DEFAULT_HEADER_HTML,
  DEFAULT_FOOTER_HTML,
  FRONTEND_URL,
} = require('../utils/emailTemplatesSettings');

const sendOtpEmail = async (to, code) => {
  const storeUrl = FRONTEND_URL;
  const bodyHtml = `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#f3e8ff;color:#7c3aed;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Verificação</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Seu código de acesso</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Válido por 10 minutos</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;text-align:center;">Use o código abaixo para continuar com segurança:</p>
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:22px;text-align:center;margin:20px 0;">
  <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#A855F7;font-family:Inter,Arial,sans-serif;">${String(code || '')}</span>
</div>
<div style="background:#f4f4f5;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#52525b;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#71717a;">Digite o código na tela de login. Ele expira em 10 minutos.</p>
</div>
<p style="margin-top:16px;text-align:center;color:#a1a1aa;font-size:12px;">Se você não solicitou este código, ignore este e-mail.</p>`;

  const html = buildEmailDocument({
    headerHtml: DEFAULT_HEADER_HTML,
    footerHtml: DEFAULT_FOOTER_HTML,
    bodyHtml,
    vars: {
      storeName: 'Space Point',
      logoUrl: `${storeUrl}/logo.png`,
      storeUrl,
      unsubscribeUrl: '',
      preheader: 'Seu código de verificação Space Point. Expira em 10 minutos.',
    },
  });

  await emailService.sendEmail(to, 'Seu código Space Point — válido por 10 minutos', html);
};

module.exports = { sendOtpEmail };
