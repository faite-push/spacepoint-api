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
}) {
  const safeStore = escapeHtml(storeName || 'Space Point');
  const safeTitle = escapeHtml(title);
  const safeSubtitle = subtitle ? escapeHtml(subtitle) : '';
  const ctaBlock = ctaLabel && ctaUrl
    ? `<div style="text-align:center;margin:28px 0 8px;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#06b6d4;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:8px;font-size:14px;">
          ${escapeHtml(ctaLabel)}
        </a>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#050505;font-family:Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#0a0a0a;border:1px solid #1f1f23;border-radius:14px;overflow:hidden;color:#fafafa;">
      <div style="padding:24px 24px 12px;text-align:center;border-bottom:1px solid #1f1f23;">
        <div style="font-size:12px;letter-spacing:2px;color:#71717a;text-transform:uppercase;">${safeStore}</div>
        <h1 style="margin:12px 0 0;font-size:22px;color:#06b6d4;">${safeTitle}</h1>
        ${safeSubtitle ? `<p style="margin:8px 0 0;color:#a1a1aa;font-size:14px;">${safeSubtitle}</p>` : ''}
      </div>
      <div style="padding:24px;color:#d4d4d8;font-size:14px;line-height:1.6;">
        ${bodyHtml}
        ${ctaBlock}
        ${footerNote ? `<p style="margin-top:24px;color:#71717a;font-size:12px;text-align:center;">${escapeHtml(footerNote)}</p>` : ''}
      </div>
    </div>
    <p style="max-width:520px;margin:12px auto 0;color:#52525b;font-size:11px;text-align:center;">
      Este é um e-mail automático. Se você não reconhece esta compra, entre em contato com o suporte.
    </p>
  </body>
</html>`;
}

function renderOrderItems(items) {
  if (!items?.length) return '';

  const rows = items.map((item) => {
    const name = escapeHtml(item.label);
    const qty = Number(item.quantity) || 1;
    const price = formatBrl(item.unitPrice * qty);
    return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #1f1f23;color:#fafafa;">${name}</td>
      <td style="padding:10px 0;border-bottom:1px solid #1f1f23;color:#a1a1aa;text-align:center;">${qty}x</td>
      <td style="padding:10px 0;border-bottom:1px solid #1f1f23;color:#fafafa;text-align:right;">${price}</td>
    </tr>`;
  }).join('');

  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <thead>
      <tr>
        <th style="text-align:left;color:#71717a;font-size:12px;padding-bottom:8px;">Produto</th>
        <th style="text-align:center;color:#71717a;font-size:12px;padding-bottom:8px;">Qtd</th>
        <th style="text-align:right;color:#71717a;font-size:12px;padding-bottom:8px;">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderOrderSummary(data) {
  const parts = [
    `<p>Olá, <strong>${escapeHtml(data.customerName)}</strong>!</p>`,
    `<p>Pedido <strong>#${escapeHtml(data.orderId)}</strong></p>`,
    renderOrderItems(data.items),
  ];

  if (data.discount > 0) {
    parts.push(`<p style="color:#a1a1aa;">Desconto: <span style="color:#22c55e;">-${formatBrl(data.discount)}</span></p>`);
  }
  if (data.deliveryFee > 0) {
    parts.push(`<p style="color:#a1a1aa;">Taxa de entrega: ${formatBrl(data.deliveryFee)}</p>`);
  }

  parts.push(`<p style="font-size:16px;margin-top:8px;">Total: <strong style="color:#06b6d4;">${formatBrl(data.total)}</strong></p>`);
  return parts.join('');
}

function orderCreatedEmail(data) {
  const bodyHtml = [
    renderOrderSummary(data),
    '<p>Recebemos seu pedido e ele está aguardando pagamento. Finalize agora para garantir seus produtos.</p>',
    data.paymentExpiresAt
      ? `<p style="color:#a1a1aa;font-size:13px;">O pagamento expira em <strong>${formatDateTime(data.paymentExpiresAt)}</strong>.</p>`
      : '',
  ].join('');

  return {
    subject: `Pedido #${data.orderId} recebido — ${data.storeName}`,
    html: layout({
      storeName: data.storeName,
      title: 'Pedido recebido',
      subtitle: 'Aguardando pagamento',
      bodyHtml,
      ctaLabel: 'Pagar agora',
      ctaUrl: data.paymentUrl,
      footerNote: data.storeName,
    }),
  };
}

function paymentPendingEmail(data) {
  const isPix = data.paymentMethod === 'PIX';
  const bodyParts = [
    renderOrderSummary(data),
    isPix
      ? '<p>Seu PIX foi gerado. Copie o código abaixo ou acesse a página de pagamento para concluir a compra.</p>'
      : '<p>Seu link de pagamento está pronto. Acesse a página abaixo para concluir a compra com cartão.</p>',
  ];

  if (isPix && data.copyPaste) {
    bodyParts.push(`<div style="background:#141417;border-radius:8px;padding:16px;margin:16px 0;word-break:break-all;font-family:monospace;font-size:12px;color:#fafafa;">
      ${escapeHtml(data.copyPaste)}
    </div>`);
  }

  if (data.expiresAt) {
    bodyParts.push(`<p style="color:#a1a1aa;font-size:13px;">Expira em <strong>${formatDateTime(data.expiresAt)}</strong>.</p>`);
  }

  return {
    subject: isPix
      ? `PIX gerado — Pedido #${data.orderId}`
      : `Finalize o pagamento — Pedido #${data.orderId}`,
    html: layout({
      storeName: data.storeName,
      title: isPix ? 'PIX gerado' : 'Pagamento pendente',
      subtitle: `Pedido #${data.orderId}`,
      bodyHtml: bodyParts.join(''),
      ctaLabel: isPix ? 'Ver QR Code / PIX' : 'Pagar com cartão',
      ctaUrl: data.paymentUrl,
      footerNote: data.storeName,
    }),
  };
}

function paymentConfirmedEmail(data) {
  const bodyHtml = [
    renderOrderSummary(data),
    '<p>Pagamento <strong style="color:#22c55e;">aprovado</strong>! Seu pedido está sendo processado.</p>',
    '<p>Acesse sua conta para acompanhar a entrega e falar com o suporte pelo chat do pedido.</p>',
  ].join('');

  return {
    subject: `Pagamento aprovado — Pedido #${data.orderId}`,
    html: layout({
      storeName: data.storeName,
      title: 'Pagamento aprovado',
      subtitle: 'Obrigado pela compra!',
      bodyHtml,
      ctaLabel: 'Ver meu pedido',
      ctaUrl: data.orderUrl,
      footerNote: data.storeName,
    }),
  };
}

function orderDeliveredEmail(data) {
  const reviewUrl = data.reviewUrl || data.orderUrl;
  const bodyHtml = [
    renderOrderSummary(data),
    '<p>Seu pedido foi <strong style="color:#22c55e;">entregue com sucesso</strong>.</p>',
    '<p>Acesse o chat do pedido para ver os detalhes da entrega e as instruções de uso.</p>',
    '<p>Conte como foi sua experiência — sua avaliação ajuda outros clientes e melhora nosso atendimento.</p>',
  ].join('');

  return {
    subject: `Pedido entregue — #${data.orderId}`,
    html: layout({
      storeName: data.storeName,
      title: 'Pedido entregue',
      subtitle: 'Aproveite sua compra!',
      bodyHtml,
      ctaLabel: data.includeReviewCta ? 'Avaliar minha compra' : 'Abrir pedido',
      ctaUrl: data.includeReviewCta ? reviewUrl : data.orderUrl,
      footerNote: data.storeName,
    }),
  };
}

function reviewInviteEmail(data) {
  const bodyHtml = [
    `<p>Olá, <strong>${escapeHtml(data.customerName)}</strong>!</p>`,
    `<p>Seu pedido <strong>#${escapeHtml(data.orderId)}</strong> já foi entregue.</p>`,
    '<p>Que tal avaliar sua experiência? Leva menos de um minuto e nos ajuda a melhorar cada vez mais.</p>',
  ].join('');

  return {
    subject: `Como foi sua compra? — #${data.orderId}`,
    html: layout({
      storeName: data.storeName,
      title: 'Avalie sua compra',
      subtitle: 'Sua opinião é muito importante',
      bodyHtml,
      ctaLabel: 'Deixar avaliação',
      ctaUrl: data.reviewUrl,
      footerNote: data.storeName,
    }),
  };
}

function orderCancelledEmail(data) {
  const reason = data.reason || 'Pedido cancelado';
  const bodyHtml = [
    `<p>Olá, <strong>${escapeHtml(data.customerName)}</strong>!</p>`,
    `<p>Seu pedido <strong>#${escapeHtml(data.orderId)}</strong> foi cancelado.</p>`,
    `<p style="color:#a1a1aa;">Motivo: ${escapeHtml(reason)}</p>`,
    data.expired
      ? '<p>Se ainda quiser comprar, você pode refazer o pedido na loja. Os produtos podem ter saído do estoque.</p>'
      : '<p>Se tiver dúvidas, entre em contato com o suporte.</p>',
  ].join('');

  return {
    subject: `Pedido cancelado — #${data.orderId}`,
    html: layout({
      storeName: data.storeName,
      title: 'Pedido cancelado',
      subtitle: reason,
      bodyHtml,
      ctaLabel: 'Voltar à loja',
      ctaUrl: data.storeUrl,
      footerNote: data.storeName,
    }),
  };
}

function abandonedCartRecoveryEmail(data) {
  const bodyHtml = [
    `<p>Olá, <strong>${escapeHtml(data.customerName)}</strong>!</p>`,
    '<p>Você deixou produtos no carrinho e eles ainda estão te esperando.</p>',
    renderOrderItems(data.items),
    `<p style="font-size:16px;margin-top:8px;">Subtotal: <strong style="color:#06b6d4;">${formatBrl(data.subtotal)}</strong></p>`,
    data.couponCode
      ? `<p style="color:#a1a1aa;font-size:13px;">Cupom salvo: <strong>${escapeHtml(data.couponCode)}</strong></p>`
      : '',
    '<p>Finalize sua compra agora antes que o estoque acabe.</p>',
  ].join('');

  return {
    subject: `Seu carrinho está esperando — ${data.storeName}`,
    html: layout({
      storeName: data.storeName,
      title: 'Você esqueceu algo?',
      subtitle: 'Seus produtos ainda estão no carrinho',
      bodyHtml,
      ctaLabel: 'Retomar compra',
      ctaUrl: data.checkoutUrl,
      footerNote: data.storeName,
    }),
  };
}

module.exports = {
  escapeHtml,
  formatBrl,
  formatDateTime,
  orderCreatedEmail,
  paymentPendingEmail,
  paymentConfirmedEmail,
  orderDeliveredEmail,
  reviewInviteEmail,
  orderCancelledEmail,
  abandonedCartRecoveryEmail,
};
