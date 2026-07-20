const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

const DEFAULT_HEADER_HTML = `<!-- Cabeçalho global (padrão Space Point) -->
<div style="background:#A855F7;padding:24px 24px 12px;text-align:center;border-bottom:1px solidrgb(255, 255, 255);">
  <a href="{{storeUrl}}" style="text-decoration:none;">
    <img src="{{logoUrl}}" width="140" alt="{{storeName}}" style="display:inline-block;border:0;outline:none;text-decoration:none;" />
  </a>
</div>`;

const DEFAULT_FOOTER_HTML = `<!-- Rodapé global (padrão Space Point) -->
<div style="padding:8px 0 24px;text-align:center;">
  <a href="{{storeUrl}}" style="text-decoration:none;">
    <img src="{{logoWhiteUrl}}" width="140" alt="{{storeName}}" style="display:block;margin:0 auto;border:0;outline:none;" />
  </a>
</div>`;

const SAMPLE_BODY_HTML = `<div style="text-align:center;margin-bottom:24px;">
  <h1 style="margin:12px 0 0;font-size:24px;color:#ffffff;">Pré-visualização do e-mail</h1>
  <p style="margin:8px 0 0;color:#f3e8ff;font-size:15px;">Assim o conteúdo principal aparece entre o cabeçalho e o rodapé</p>
  <hr style="border-color:#ffffff13;margin:24px 0;border-width:1px;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;">Este é o conteúdo principal do e-mail. Edite o bloco para personalizar a mensagem enviada aos clientes.</p>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">{{ctaLabel}}</a>
</div>`;

const DEFAULT_BODIES = {
  orderCreated: `<div style="text-align:center;margin-bottom:24px;">
  <h1 style="margin:12px 0 0;font-size:24px;color:#ffffff;">Pedido recebido</h1>
  <p style="margin:8px 0 0;color:#f3e8ff;font-size:15px;">Aguardando pagamento</p>
  <hr style="border-color:#ffffff13;margin:24px 0;border-width:1px;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;">Recebemos seu pedido <strong>#{{orderId}}</strong> e ele está aguardando pagamento. Finalize agora para garantir seus produtos.</p>
{{#if itemsHtml}}
<div style="border:1px solid #ffffff13;border-radius:10px;padding:10px;margin:24px 0;">{{itemsHtml}}</div>
{{/if}}
{{#if totalLabel}}
<p style="font-size:16px;margin:8px 0;">Total: <strong style="color:#A855F7;">{{totalLabel}}</strong></p>
{{/if}}
{{#if paymentExpiresLabel}}
<p style="color:#a1a1aa;font-size:13px;">O pagamento expira em <strong>{{paymentExpiresLabel}}</strong>.</p>
{{/if}}
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Pagar agora</a>
</div>
<p style="margin-top:12px;text-align:center;color:#a1a1aa;">Qualquer dúvida é só chamar nosso suporte pelo chat ou responder este e-mail.</p>`,

  paymentPending: `<div style="text-align:center;margin-bottom:24px;">
  <h1 style="margin:12px 0 0;font-size:24px;color:#ffffff;">Pagamento pendente</h1>
  <p style="margin:8px 0 0;color:#f3e8ff;font-size:15px;">Finalize sua compra</p>
  <hr style="border-color:#ffffff13;margin:24px 0;border-width:1px;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;">Seu pedido <strong>#{{orderId}}</strong> ainda está aguardando pagamento. Conclua agora para não perder seus itens.</p>
{{#if itemsHtml}}
<div style="border:1px solid #ffffff13;border-radius:10px;padding:10px;margin:24px 0;">{{itemsHtml}}</div>
{{/if}}
{{#if copyPaste}}
<div style="background:#141417;border-radius:8px;padding:16px;margin:16px 0;word-break:break-all;font-family:monospace;font-size:12px;color:#fafafa;">{{copyPaste}}</div>
{{/if}}
{{#if paymentExpiresLabel}}
<p style="color:#a1a1aa;font-size:13px;">Expira em <strong>{{paymentExpiresLabel}}</strong>.</p>
{{/if}}
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">{{ctaLabel}}</a>
</div>
<p style="margin-top:12px;text-align:center;color:#a1a1aa;">Qualquer dúvida é só chamar nosso suporte pelo chat ou responder este e-mail.</p>`,

  paymentConfirmed: `<div style="text-align:center;margin-bottom:24px;">
  <h1 style="margin:12px 0 0;font-size:24px;color:#ffffff;">Pagamento aprovado</h1>
  <p style="margin:8px 0 0;color:#f3e8ff;font-size:15px;">Obrigado pela compra!</p>
  <hr style="border-color:#ffffff13;margin:24px 0;border-width:1px;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;">Pagamento do pedido <strong>#{{orderId}}</strong> <strong style="color:#22c55e;">aprovado</strong>! Seu pedido está sendo processado.</p>
{{#if itemsHtml}}
<div style="border:1px solid #ffffff13;border-radius:10px;padding:10px;margin:24px 0;">{{itemsHtml}}</div>
{{/if}}
<p style="max-width:520px;">Acesse sua conta para acompanhar a entrega e falar com o suporte pelo chat do pedido.</p>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Ver meu pedido</a>
</div>
<p style="margin-top:12px;text-align:center;color:#a1a1aa;">Qualquer dúvida é só chamar nosso suporte pelo chat ou responder este e-mail.</p>`,

  orderDelivered: `<div style="text-align:center;margin-bottom:24px;">
  <h1 style="margin:12px 0 0;font-size:24px;color:#ffffff;">Pedido entregue</h1>
  <p style="margin:8px 0 0;color:#f3e8ff;font-size:15px;">Aproveite sua compra!</p>
  <hr style="border-color:#ffffff13;margin:24px 0;border-width:1px;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;">Seu pedido <strong>#{{orderId}}</strong> foi <strong style="color:#22c55e;">entregue com sucesso</strong>.</p>
{{#if itemsHtml}}
<div style="border:1px solid #ffffff13;border-radius:10px;padding:10px;margin:24px 0;">{{itemsHtml}}</div>
{{/if}}
<p style="max-width:520px;">Acesse o chat do pedido para ver os detalhes da entrega e as instruções de uso.</p>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">{{ctaLabel}}</a>
</div>
<p style="margin-top:12px;text-align:center;color:#a1a1aa;">Qualquer dúvida é só chamar nosso suporte pelo chat ou responder este e-mail.</p>`,

  orderCancelled: `<div style="text-align:center;margin-bottom:24px;">
  <h1 style="margin:12px 0 0;font-size:24px;color:#ffffff;">Pedido cancelado</h1>
  <p style="margin:8px 0 0;color:#f3e8ff;font-size:15px;">{{subtitle}}</p>
  <hr style="border-color:#ffffff13;margin:24px 0;border-width:1px;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;">Seu pedido <strong>#{{orderId}}</strong> foi cancelado.</p>
{{#if reason}}
<p style="color:#a1a1aa;">Motivo: {{reason}}</p>
{{/if}}
<p style="max-width:520px;">Se ainda quiser comprar, você pode refazer o pedido na loja.</p>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Voltar à loja</a>
</div>
<p style="margin-top:12px;text-align:center;color:#a1a1aa;">Qualquer dúvida é só chamar nosso suporte pelo chat ou responder este e-mail.</p>`,

  reviewInvite: `<div style="text-align:center;margin-bottom:24px;">
  <h1 style="margin:12px 0 0;font-size:24px;color:#ffffff;">Avalie sua compra</h1>
  <p style="margin:8px 0 0;color:#f3e8ff;font-size:15px;">Sua opinião é muito importante</p>
  <hr style="border-color:#ffffff13;margin:24px 0;border-width:1px;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;">Seu pedido <strong>#{{orderId}}</strong> já foi entregue. Que tal avaliar sua experiência? Leva menos de um minuto e nos ajuda a melhorar cada vez mais.</p>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Deixar avaliação</a>
</div>
<p style="margin-top:12px;text-align:center;color:#a1a1aa;">Qualquer dúvida é só chamar nosso suporte pelo chat ou responder este e-mail.</p>`,

  abandonedCartRecovery: `<div style="text-align:center;margin-bottom:24px;">
  <h1 style="margin:12px 0 0;font-size:24px;color:#ffffff;">Seu carrinho está te esperando!</h1>
  <p style="margin:8px 0 0;color:#f3e8ff;font-size:15px;">Não deixe sua compra escapar</p>
  <hr style="border-color:#ffffff13;margin:24px 0;border-width:1px;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;">Notamos que você deixou um item em seu carrinho. Caso tenha alguma dúvida, estamos à disposição para te ajudar com essa compra.</p>
{{#if itemsHtml}}
<div style="border:1px solid #ffffff13;border-radius:10px;padding:10px;margin:24px 0;">{{itemsHtml}}</div>
{{/if}}
{{#if totalLabel}}
<p style="font-size:16px;margin:8px 0;">Subtotal: <strong style="color:#A855F7;">{{totalLabel}}</strong></p>
{{/if}}
{{#if couponCode}}
<p style="color:#a1a1aa;font-size:13px;">Cupom salvo: <strong>{{couponCode}}</strong></p>
{{/if}}
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Finalizar Compra Agora</a>
</div>
<p style="text-align:center;">
  <a href="{{ctaUrl}}" style="color:#A855F7;text-decoration:none;font-weight:500;">Ver meu carrinho completo</a>
</p>
<p style="margin-top:12px;text-align:center;color:#a1a1aa;">Qualquer dúvida é só chamar nosso suporte pelo chat ou responder este e-mail.</p>`,

  abandonedProductRecovery: `<div style="text-align:center;margin-bottom:24px;">
  <h1 style="margin:12px 0 0;font-size:24px;color:#ffffff;">Esse produto ainda está disponível</h1>
  <p style="margin:8px 0 0;color:#f3e8ff;font-size:15px;">Garanta o seu antes que acabe</p>
  <hr style="border-color:#ffffff13;margin:24px 0;border-width:1px;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;">Você demonstrou interesse em um produto que ainda está disponível. Finalize agora e garanta o seu.</p>
{{#if itemsHtml}}
<div style="border:1px solid #ffffff13;border-radius:10px;padding:10px;margin:24px 0;">{{itemsHtml}}</div>
{{/if}}
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Garantir agora</a>
</div>
<p style="margin-top:12px;text-align:center;color:#a1a1aa;">Qualquer dúvida é só chamar nosso suporte pelo chat ou responder este e-mail.</p>`,
};

/** Catálogo de blocos editáveis por aba */
const EMAIL_BLOCK_CATALOG = {
  components: [
    {
      id: 'header',
      key: 'headerHtml',
      title: 'Cabeçalho do e-mail',
      description: 'Faixa roxa com logo no topo de todos os e-mails.',
      kind: 'component',
    },
    {
      id: 'footer',
      key: 'footerHtml',
      title: 'Rodapé do e-mail',
      description: 'Logo clara + aviso de e-mail automático no fechamento.',
      kind: 'component',
    },
  ],
  transactional: [
    {
      id: 'orderCreated',
      key: 'bodies.orderCreated',
      title: 'Pedido recebido',
      description: 'Enviado quando o cliente finaliza a compra e o pedido fica aguardando pagamento.',
      kind: 'body',
      defaultTitle: 'Pedido recebido',
      defaultSubtitle: 'Aguardando pagamento',
    },
    {
      id: 'paymentPending',
      key: 'bodies.paymentPending',
      title: 'Pagamento pendente',
      description: 'Lembrete com link/PIX para concluir o pagamento.',
      kind: 'body',
      defaultTitle: 'Pagamento pendente',
      defaultSubtitle: 'Finalize sua compra',
    },
    {
      id: 'paymentConfirmed',
      key: 'bodies.paymentConfirmed',
      title: 'Pagamento aprovado',
      description: 'Confirmação de pagamento e próximos passos da entrega.',
      kind: 'body',
      defaultTitle: 'Pagamento aprovado',
      defaultSubtitle: 'Obrigado pela compra!',
    },
    {
      id: 'orderDelivered',
      key: 'bodies.orderDelivered',
      title: 'Pedido entregue',
      description: 'Aviso de entrega com CTA para abrir o pedido ou avaliar.',
      kind: 'body',
      defaultTitle: 'Pedido entregue',
      defaultSubtitle: 'Aproveite sua compra!',
    },
    {
      id: 'orderCancelled',
      key: 'bodies.orderCancelled',
      title: 'Pedido cancelado',
      description: 'Notificação de cancelamento ou expiração de pagamento.',
      kind: 'body',
      defaultTitle: 'Pedido cancelado',
      defaultSubtitle: 'Pedido não concluído',
    },
    {
      id: 'reviewInvite',
      key: 'bodies.reviewInvite',
      title: 'Convite de avaliação',
      description: 'Pede feedback após a entrega do pedido.',
      kind: 'body',
      defaultTitle: 'Avalie sua compra',
      defaultSubtitle: 'Sua opinião é importante',
    },
  ],
  abandonedCart: [
    {
      id: 'abandonedCartRecovery',
      key: 'bodies.abandonedCartRecovery',
      title: 'Recuperação de carrinho',
      description: 'E-mail automático da régua de carrinho abandonado.',
      kind: 'body',
      defaultTitle: 'Seu carrinho está te esperando!',
      defaultSubtitle: 'Não deixe sua compra escapar',
    },
  ],
  abandonedProduct: [
    {
      id: 'abandonedProductRecovery',
      key: 'bodies.abandonedProductRecovery',
      title: 'Recuperação de produto',
      description: 'E-mail focado em produtos específicos abandonados no carrinho.',
      kind: 'body',
      defaultTitle: 'Esse produto ainda está disponível',
      defaultSubtitle: 'Garanta o seu antes que acabe',
    },
  ],
};

function normalizeEmailTemplates(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const bodiesSrc = src.bodies && typeof src.bodies === 'object' ? src.bodies : {};
  const bodies = {};
  for (const key of Object.keys(DEFAULT_BODIES)) {
    const saved = typeof bodiesSrc[key] === 'string' ? bodiesSrc[key].trim() : '';
    bodies[key] = saved || DEFAULT_BODIES[key];
  }

  const isLegacyComponent = (html) =>
    /<thead>|<tfoot>|#06b6d4|Este é um e-mail automático|<\/div>\s*<\/div>\s*<p/i.test(String(html || ''));

  const headerHtml =
    typeof src.headerHtml === 'string' && src.headerHtml.trim() && !isLegacyComponent(src.headerHtml)
      ? src.headerHtml
      : DEFAULT_HEADER_HTML;
  const footerHtml =
    typeof src.footerHtml === 'string' && src.footerHtml.trim() && !isLegacyComponent(src.footerHtml)
      ? src.footerHtml
      : DEFAULT_FOOTER_HTML;

  return {
    headerHtml,
    footerHtml,
    subjects: src.subjects && typeof src.subjects === 'object' ? src.subjects : {},
    bodies,
  };
}

function applyEmailTemplate(html, vars = {}) {
  let out = String(html || '');

  out = out.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, inner) => {
    const value = vars[key];
    if (value === undefined || value === null || value === '' || value === false) return '';
    return inner;
  });

  out = out.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (vars[key] === undefined || vars[key] === null) return '';
    return String(vars[key]);
  });

  return out;
}

function buildEmailDocument({ headerHtml, footerHtml, bodyHtml, vars }) {
  const header = applyEmailTemplate(headerHtml, vars);
  const footer = applyEmailTemplate(footerHtml, vars);
  const body = applyEmailTemplate(bodyHtml, vars);
  const unsubscribe = vars?.unsubscribeUrl
    ? ` <a href="${String(vars.unsubscribeUrl)}" style="color:#71717a;text-decoration:none;">Não quero mais receber estes lembretes</a>.`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;font-family:Inter,Arial,sans-serif;background:#050505;">
  <div style="max-width:620px;margin:0 auto;background:#0a0a0a;border:1px solid #1f1f23;border-radius:14px;overflow:hidden;color:#fafafa;">
    ${header}
    <div style="padding:5px 24px;color:#d4d4d8;font-size:14px;line-height:1.6;">
      ${body}
      ${footer}
    </div>
  </div>
  <p style="max-width:520px;margin:16px auto 0;color:#52525b;font-size:11px;text-align:center;font-family:Inter,Arial,sans-serif;">
    Este é um e-mail automático.${unsubscribe}
  </p>
</body>
</html>`;
}

async function getEmailTemplates(prisma) {
  const config = await prisma.siteConfig.findUnique({
    where: { id: 'default' },
    select: {
      emailTemplates: true,
      storeName: true,
      logoUrl: true,
      contactEmail: true,
      contactPhone: true,
    },
  });

  const storeUrl = FRONTEND_URL;
  const logoUrl = config?.logoUrl || `${storeUrl}/logo.png`;
  const logoWhiteUrl = `${storeUrl}/logo-white.png`;

  return {
    templates: normalizeEmailTemplates(config?.emailTemplates),
    branding: {
      storeName: config?.storeName?.trim() || 'Space Point',
      logoUrl,
      logoWhiteUrl,
      storeUrl,
      contactEmail: config?.contactEmail || '',
      contactPhone: config?.contactPhone || '',
      year: String(new Date().getFullYear()),
      customerName: 'Cliente',
      ctaUrl: storeUrl,
      ctaLabel: 'Abrir loja',
      unsubscribeUrl: '#',
    },
  };
}

module.exports = {
  DEFAULT_HEADER_HTML,
  DEFAULT_FOOTER_HTML,
  SAMPLE_BODY_HTML,
  EMAIL_BLOCK_CATALOG,
  DEFAULT_BODIES,
  normalizeEmailTemplates,
  applyEmailTemplate,
  buildEmailDocument,
  getEmailTemplates,
};
