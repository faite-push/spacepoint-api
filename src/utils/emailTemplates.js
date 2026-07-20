const {
  applyEmailTemplate,
  buildEmailDocument,
  normalizeEmailTemplates,
  DEFAULT_HEADER_HTML,
  DEFAULT_FOOTER_HTML,
  DEFAULT_BODIES,
} = require('./emailTemplatesSettings');

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
  };

  const ctaBlock = ctaLabel && ctaUrl
    ? `<div style="text-align:center;margin:22px 0;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#A855F7;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">
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
        <h3 style="margin:0;font-size:17px;color:#ffffff;font-weight:600;">${name}</h3>
        <p style="margin:4px 0 0;font-size:18px;color:#A855F7;font-weight:700;">${price}</p>
        <p style="margin:2px 0 0;color:#a1a1aa;font-size:13px;">${qty}x</p>
      </td>
    </tr>`;
  }).join('');

  return `<table style="width:100%;border-collapse:collapse;">${rows}</table>`;
}

function resolveBodyTemplate(data, key) {
  const custom = data.customBodies?.[key];
  if (typeof custom === 'string' && custom.trim()) return custom;
  return DEFAULT_BODIES[key] || null;
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

function orderCreatedEmail(data) {
  return {
    subject: `Pedido #${data.orderId} recebido — ${data.storeName}`,
    html: layout({
      ...sharedLayoutFields(data, {
        paymentExpiresLabel: data.paymentExpiresAt ? formatDateTime(data.paymentExpiresAt) : '',
      }),
      title: 'Pedido recebido',
      subtitle: 'Aguardando pagamento',
      bodyHtml: '',
      ctaLabel: 'Pagar agora',
      ctaUrl: data.paymentUrl,
      customBodyHtml: resolveBodyTemplate(data, 'orderCreated'),
    }),
  };
}

function paymentPendingEmail(data) {
  const isPix = data.paymentMethod === 'PIX';
  return {
    subject: isPix
      ? `PIX gerado — Pedido #${data.orderId}`
      : `Finalize o pagamento — Pedido #${data.orderId}`,
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
      customBodyHtml: resolveBodyTemplate(data, 'paymentPending'),
    }),
  };
}

function paymentConfirmedEmail(data) {
  return {
    subject: `Pagamento aprovado — Pedido #${data.orderId}`,
    html: layout({
      ...sharedLayoutFields(data),
      title: 'Pagamento aprovado',
      subtitle: 'Obrigado pela compra!',
      bodyHtml: '',
      ctaLabel: 'Ver meu pedido',
      ctaUrl: data.orderUrl,
      customBodyHtml: resolveBodyTemplate(data, 'paymentConfirmed'),
    }),
  };
}

function orderDeliveredEmail(data) {
  const reviewUrl = data.reviewUrl || data.orderUrl;
  return {
    subject: `Pedido entregue — #${data.orderId}`,
    html: layout({
      ...sharedLayoutFields(data),
      title: 'Pedido entregue',
      subtitle: 'Aproveite sua compra!',
      bodyHtml: '',
      ctaLabel: data.includeReviewCta ? 'Avaliar minha compra' : 'Abrir pedido',
      ctaUrl: data.includeReviewCta ? reviewUrl : data.orderUrl,
      customBodyHtml: resolveBodyTemplate(data, 'orderDelivered'),
    }),
  };
}

function reviewInviteEmail(data) {
  return {
    subject: `Como foi sua compra? — #${data.orderId}`,
    html: layout({
      ...sharedLayoutFields(data),
      title: 'Avalie sua compra',
      subtitle: 'Sua opinião é muito importante',
      bodyHtml: '',
      ctaLabel: 'Deixar avaliação',
      ctaUrl: data.reviewUrl,
      customBodyHtml: resolveBodyTemplate(data, 'reviewInvite'),
    }),
  };
}

function orderCancelledEmail(data) {
  const reason = data.reason || 'Pedido cancelado';
  return {
    subject: `Pedido cancelado — #${data.orderId}`,
    html: layout({
      ...sharedLayoutFields(data, { reason }),
      title: 'Pedido cancelado',
      subtitle: reason,
      bodyHtml: '',
      ctaLabel: 'Voltar à loja',
      ctaUrl: data.storeUrl,
      customBodyHtml: resolveBodyTemplate(data, 'orderCancelled'),
    }),
  };
}

function abandonedCartRecoveryEmail(data) {
  const pixel = data.openPixelUrl
    ? `<img src="${escapeHtml(data.openPixelUrl)}" width="1" height="1" alt="" style="display:none;" />`
    : '';
  const bodyTemplate = resolveBodyTemplate(data, 'abandonedCartRecovery');

  return {
    subject: `Seu carrinho está esperando — ${data.storeName}`,
    html: layout({
      ...sharedLayoutFields(data, {
        itemsHtml: renderOrderItems(data.items),
        totalLabel: data.subtotal != null ? formatBrl(data.subtotal) : '',
        couponCode: data.couponCode || '',
      }),
      title: 'Seu carrinho está te esperando!',
      subtitle: 'Não deixe sua compra escapar',
      bodyHtml: pixel,
      ctaLabel: 'Finalizar Compra Agora',
      ctaUrl: data.checkoutUrl,
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
};
