const {
  applyEmailTemplate,
  buildEmailDocument,
  normalizeEmailTemplates,
  DEFAULT_HEADER_HTML,
  DEFAULT_FOOTER_HTML,
  DEFAULT_BODIES,
  DEFAULT_SUBJECTS,
  DEFAULT_PREHEADERS,
} = require('./emailTemplatesSettings');
const { sequenceTemplateKey } = require('./recoverySequence');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBrl(cents) {
  return (Math.max(0, Number(cents) || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatDateTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function layout({
  storeName,
  title,
  subtitle,
  bodyHtml,
  ctaLabel,
  ctaUrl,
  footerNote,
  headerHtml,
  footerHtml,
  logoUrl,
  logoWhiteUrl,
  contactEmail,
  storeUrl,
  customerName,
  orderId,
  itemsHtml,
  totalLabel,
  paymentExpiresLabel,
  copyPaste,
  couponCode,
  reason,
  unsubscribeUrl,
  customBodyHtml,
  preheader,
}) {
  const FRONTEND = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const vars = {
    storeName: storeName || 'Space Point',
    title: title || '',
    subtitle: subtitle || '',
    logoUrl: logoUrl || `${FRONTEND}/logo.png`,
    logoWhiteUrl: logoWhiteUrl || `${FRONTEND}/logo-white.png`,
    contactEmail: contactEmail || '',
    storeUrl: storeUrl || FRONTEND,
    year: String(new Date().getFullYear()),
    footerNote: footerNote || storeName || 'Space Point',
    customerName: customerName || 'Cliente',
    orderId: orderId || '',
    itemsHtml: itemsHtml || '',
    totalLabel: totalLabel || '',
    paymentExpiresLabel: paymentExpiresLabel || '',
    copyPaste: copyPaste || '',
    couponCode: couponCode || '',
    reason: reason || '',
    ctaUrl: ctaUrl || storeUrl || FRONTEND,
    ctaLabel: ctaLabel || 'Abrir loja',
    unsubscribeUrl: unsubscribeUrl || '#',
    preheader: preheader || '',
  };

  const ctaBlock = ctaLabel && ctaUrl
    ? `<div style="text-align:center;margin:22px 0;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">
          ${escapeHtml(ctaLabel)}
        </a>
      </div>`
    : '';

  const resolvedBody = customBodyHtml
    ? applyEmailTemplate(customBodyHtml, vars)
    : `${bodyHtml}${ctaBlock}`;

  return buildEmailDocument({
    headerHtml: headerHtml || DEFAULT_HEADER_HTML,
    footerHtml: footerHtml || DEFAULT_FOOTER_HTML,
    bodyHtml: resolvedBody,
    vars,
  });
}

/** Anexa branding/templates salvos no SiteConfig aos dados do e-mail */
function withEmailLayout(data = {}, templates = null) {
  const normalized = normalizeEmailTemplates(templates);
  const FRONTEND = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  return {
    ...data,
    headerHtml: normalized.headerHtml,
    footerHtml: normalized.footerHtml,
    customBodies: data.customBodies || normalized.bodies,
    customSubjects: data.customSubjects || normalized.subjects,
    customPreheaders: data.customPreheaders || normalized.preheaders,
    logoUrl: data.logoUrl || '',
    logoWhiteUrl: data.logoWhiteUrl || `${FRONTEND}/logo-white.png`,
    storeUrl: data.storeUrl || FRONTEND,
    contactEmail: data.contactEmail || '',
  };
}

function renderOrderItems(items) {
  if (!items?.length) return '';

  const rows = items.map((item) => {
    const name = escapeHtml(item.label);
    const qty = Number(item.quantity) || 1;
    const price = formatBrl(item.unitPrice * qty);
    const image = item.imageUrl
      ? `<img src="${escapeHtml(item.imageUrl)}" alt="" width="80" style="border-radius:8px;object-fit:contain;display:block;" />`
      : '';
    return `<tr>
      ${image ? `<td style="width:100px;vertical-align:middle;padding:6px 10px 6px 0;">${image}</td>` : ''}
      <td style="vertical-align:middle;text-align:left;padding:6px 0;">
        <h3 style="margin:0;font-size:17px;color:#18181b;font-weight:600;">${name}</h3>
        <p style="margin:4px 0 0;font-size:18px;color:#A855F7;font-weight:700;">${price}</p>
        <p style="margin:2px 0 0;color:#71717a;font-size:13px;">${qty}x</p>
      </td>
    </tr>`;
  }).join('');

  return `<table style="width:100%;border-collapse:collapse;">${rows}</table>`;
}

function resolveBodyTemplate(data, key, stepIndex = 1) {
  const stepKey = sequenceTemplateKey(key, stepIndex);
  const pick = (k) => {
    const custom = data.customBodies?.[k];
    if (typeof custom === 'string' && custom.trim()) return custom;
    if (typeof DEFAULT_BODIES[k] === 'string' && DEFAULT_BODIES[k].trim()) return DEFAULT_BODIES[k];
    return null;
  };
  return pick(stepKey) || pick(key) || null;
}

function resolveSubject(data, key, vars = {}, stepIndex = 1) {
  const stepKey = sequenceTemplateKey(key, stepIndex);
  const pick = (k) => {
    const custom = data.customSubjects?.[k];
    if (typeof custom === 'string' && custom.trim()) return custom;
    if (DEFAULT_SUBJECTS[k]) return DEFAULT_SUBJECTS[k];
    return null;
  };
  const template = pick(stepKey) || pick(key) || `${vars.storeName || 'Space Point'}`;
  return applyEmailTemplate(template, vars);
}

function resolvePreheader(data, key, stepIndex = 1) {
  const stepKey = sequenceTemplateKey(key, stepIndex);
  const pick = (k) => {
    const custom = data.customPreheaders?.[k];
    if (typeof custom === 'string' && custom.trim()) return custom;
    if (DEFAULT_PREHEADERS[k]) return DEFAULT_PREHEADERS[k];
    return null;
  };
  return pick(stepKey) || pick(key) || '';
}

function sharedLayoutFields(data, extras = {}) {
  return {
    storeName: data.storeName,
    headerHtml: data.headerHtml,
    footerHtml: data.footerHtml,
    logoUrl: data.logoUrl,
    logoWhiteUrl: data.logoWhiteUrl,
    contactEmail: data.contactEmail,
    storeUrl: data.storeUrl,
    customerName: data.customerName,
    orderId: data.orderId,
    itemsHtml: extras.itemsHtml ?? (data.items ? renderOrderItems(data.items) : ''),
    totalLabel: extras.totalLabel ?? (data.total != null ? formatBrl(data.total) : ''),
    paymentExpiresLabel: extras.paymentExpiresLabel || '',
    copyPaste: extras.copyPaste || '',
    couponCode: extras.couponCode || data.couponCode || '',
    reason: extras.reason || '',
    unsubscribeUrl: data.unsubscribeUrl || '#',
    footerNote: data.storeName,
  };
}

function subjectVars(data, extras = {}) {
  return {
    storeName: data.storeName || 'Space Point',
    customerName: data.customerName || 'Cliente',
    orderId: data.orderId || '',
    ...extras,
  };
}

function orderCreatedEmail(data) {
  const vars = subjectVars(data);
  return {
    subject: resolveSubject(data, 'orderCreated', vars),
    html: layout({
      ...sharedLayoutFields(data, {
        paymentExpiresLabel: data.paymentExpiresAt ? formatDateTime(data.paymentExpiresAt) : '',
      }),
      title: 'Pedido recebido',
      subtitle: 'Aguardando pagamento',
      bodyHtml: '',
      ctaLabel: 'Garantir meu pedido',
      ctaUrl: data.paymentUrl,
      preheader: resolvePreheader(data, 'orderCreated'),
      customBodyHtml: resolveBodyTemplate(data, 'orderCreated'),
    }),
  };
}

function paymentPendingEmail(data) {
  const isPix = data.paymentMethod === 'PIX';
  const vars = subjectVars(data);
  return {
    subject: resolveSubject(data, 'paymentPending', vars),
    html: layout({
      ...sharedLayoutFields(data, {
        copyPaste: isPix ? data.copyPaste : '',
        paymentExpiresLabel: data.expiresAt ? formatDateTime(data.expiresAt) : '',
      }),
      title: isPix ? 'PIX gerado' : 'Pagamento pendente',
      subtitle: `Pedido #${data.orderId}`,
      bodyHtml: '',
      ctaLabel: isPix ? 'Ver QR Code / PIX' : 'Pagar com cartão',
      ctaUrl: data.paymentUrl,
      preheader: resolvePreheader(data, 'paymentPending'),
      customBodyHtml: resolveBodyTemplate(data, 'paymentPending'),
    }),
  };
}

function paymentConfirmedEmail(data) {
  const vars = subjectVars(data);
  return {
    subject: resolveSubject(data, 'paymentConfirmed', vars),
    html: layout({
      ...sharedLayoutFields(data),
      title: 'Pagamento aprovado',
      subtitle: 'Obrigado pela compra!',
      bodyHtml: '',
      ctaLabel: 'Ver meu pedido',
      ctaUrl: data.orderUrl,
      preheader: resolvePreheader(data, 'paymentConfirmed'),
      customBodyHtml: resolveBodyTemplate(data, 'paymentConfirmed'),
    }),
  };
}

function orderDeliveredEmail(data) {
  const reviewUrl = data.reviewUrl || data.orderUrl;
  const vars = subjectVars(data);
  return {
    subject: resolveSubject(data, 'orderDelivered', vars),
    html: layout({
      ...sharedLayoutFields(data),
      title: 'Pedido entregue',
      subtitle: 'Aproveite sua compra!',
      bodyHtml: '',
      ctaLabel: data.includeReviewCta ? 'Avaliar minha compra' : 'Abrir pedido',
      ctaUrl: data.includeReviewCta ? reviewUrl : data.orderUrl,
      preheader: resolvePreheader(data, 'orderDelivered'),
      customBodyHtml: resolveBodyTemplate(data, 'orderDelivered'),
    }),
  };
}

function reviewInviteEmail(data) {
  const vars = subjectVars(data);
  return {
    subject: resolveSubject(data, 'reviewInvite', vars),
    html: layout({
      ...sharedLayoutFields(data),
      title: 'Avalie sua compra',
      subtitle: 'Sua opinião é muito importante',
      bodyHtml: '',
      ctaLabel: 'Deixar avaliação',
      ctaUrl: data.reviewUrl,
      preheader: resolvePreheader(data, 'reviewInvite'),
      customBodyHtml: resolveBodyTemplate(data, 'reviewInvite'),
    }),
  };
}

function orderCancelledEmail(data) {
  const reason = data.reason || 'Pedido cancelado';
  const vars = subjectVars(data);
  return {
    subject: resolveSubject(data, 'orderCancelled', vars),
    html: layout({
      ...sharedLayoutFields(data, { reason }),
      title: 'Pedido cancelado',
      subtitle: reason,
      bodyHtml: '',
      ctaLabel: 'Refazer pedido',
      ctaUrl: data.storeUrl,
      preheader: resolvePreheader(data, 'orderCancelled'),
      customBodyHtml: resolveBodyTemplate(data, 'orderCancelled'),
    }),
  };
}

function abandonedCartRecoveryEmail(data) {
  const stepIndex = data.stepIndex || 1;
  const pixel = data.openPixelUrl
    ? `<img src="${escapeHtml(data.openPixelUrl)}" width="1" height="1" alt="" style="display:none;" />`
    : '';
  const bodyTemplate = resolveBodyTemplate(data, 'abandonedCartRecovery', stepIndex);
  const vars = subjectVars(data);
  const titles = {
    1: { title: 'Seu carrinho está te esperando!', subtitle: 'Não deixe sua compra escapar' },
    2: { title: 'Ainda dá tempo de finalizar', subtitle: 'Seus itens continuam reservados' },
    3: { title: 'Última chance do seu carrinho', subtitle: 'Finalize antes que os itens saiam' },
  };
  const copy = titles[Math.min(3, stepIndex)] || titles[1];

  return {
    subject: resolveSubject(data, 'abandonedCartRecovery', vars, stepIndex),
    html: layout({
      ...sharedLayoutFields(data, {
        itemsHtml: renderOrderItems(data.items),
        totalLabel: data.subtotal != null ? formatBrl(data.subtotal) : '',
        couponCode: data.couponCode || '',
      }),
      title: copy.title,
      subtitle: copy.subtitle,
      bodyHtml: pixel,
      ctaLabel: 'Garantir meu pedido',
      ctaUrl: data.checkoutUrl,
      preheader: resolvePreheader(data, 'abandonedCartRecovery', stepIndex),
      customBodyHtml: bodyTemplate ? `${pixel}${bodyTemplate}` : null,
    }),
  };
}

function abandonedProductRecoveryEmail(data) {
  const stepIndex = data.stepIndex || 1;
  const pixel = data.openPixelUrl
    ? `<img src="${escapeHtml(data.openPixelUrl)}" width="1" height="1" alt="" style="display:none;" />`
    : '';
  const bodyTemplate = resolveBodyTemplate(data, 'abandonedProductRecovery', stepIndex);
  const vars = subjectVars(data);
  const titles = {
    1: { title: 'Esse produto ainda está disponível', subtitle: 'Garanta o seu antes que acabe' },
    2: { title: 'O produto continua em estoque', subtitle: 'Outros clientes também estão olhando' },
    3: { title: 'Último aviso de estoque', subtitle: 'Garanta agora antes que acabe' },
  };
  const copy = titles[Math.min(3, stepIndex)] || titles[1];

  return {
    subject: resolveSubject(data, 'abandonedProductRecovery', vars, stepIndex),
    html: layout({
      ...sharedLayoutFields(data, {
        itemsHtml: data.items ? renderOrderItems(data.items) : '',
        totalLabel: data.unitPrice != null ? formatBrl(data.unitPrice) : '',
      }),
      title: copy.title,
      subtitle: copy.subtitle,
      bodyHtml: pixel,
      ctaLabel: 'Garantir agora',
      ctaUrl: data.productUrl,
      preheader: resolvePreheader(data, 'abandonedProductRecovery', stepIndex),
      customBodyHtml: bodyTemplate ? `${pixel}${bodyTemplate}` : null,
    }),
  };
}

function cancelledOrderRecoveryEmail(data) {
  const stepIndex = data.stepIndex || 1;
  const pixel = data.openPixelUrl
    ? `<img src="${escapeHtml(data.openPixelUrl)}" width="1" height="1" alt="" style="display:none;" />`
    : '';
  const bodyTemplate = resolveBodyTemplate(data, 'cancelledOrderRecovery', stepIndex);
  const vars = subjectVars(data);
  const reason = data.reason || 'Pedido cancelado';
  const titles = {
    1: { title: 'Ainda quer esses produtos?', subtitle: 'Refaça o pedido em poucos cliques' },
    2: { title: 'Seu pedido ainda pode ser refeito', subtitle: 'Montamos o carrinho para você' },
    3: { title: 'Última chance de recuperar o pedido', subtitle: 'É só um clique para remontar' },
  };
  const copy = titles[Math.min(3, stepIndex)] || titles[1];

  return {
    subject: resolveSubject(data, 'cancelledOrderRecovery', vars, stepIndex),
    html: layout({
      ...sharedLayoutFields(data, {
        itemsHtml: data.items ? renderOrderItems(data.items) : '',
        totalLabel: data.total != null ? formatBrl(data.total) : '',
        reason,
      }),
      title: copy.title,
      subtitle: copy.subtitle,
      bodyHtml: pixel,
      ctaLabel: 'Refazer meu pedido',
      ctaUrl: data.storeUrl,
      preheader: resolvePreheader(data, 'cancelledOrderRecovery', stepIndex),
      customBodyHtml: bodyTemplate ? `${pixel}${bodyTemplate}` : null,
    }),
  };
}

module.exports = {
  escapeHtml,
  formatBrl,
  formatDateTime,
  layout,
  withEmailLayout,
  orderCreatedEmail,
  paymentPendingEmail,
  paymentConfirmedEmail,
  orderDeliveredEmail,
  reviewInviteEmail,
  orderCancelledEmail,
  abandonedCartRecoveryEmail,
  abandonedProductRecoveryEmail,
  cancelledOrderRecoveryEmail,
};
