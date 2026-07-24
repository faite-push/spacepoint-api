/** Mascara código digital (ex.: ABCD••••WXYZ). */
function maskCode(code) {
  const value = String(code || '');
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

/** Mascara e-mail para logs: a***@dominio.com */
function maskEmail(email) {
  const raw = String(email || '').trim();
  const at = raw.indexOf('@');
  if (at < 1) return '[email]';
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

/**
 * Em mensagens DELIVERY (JSON no content), mascara deliveryContent.
 */
function maskDeliveryMessageContent(content) {
  if (!content || typeof content !== 'string') return content;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return content;
    if (parsed.deliveryContent) {
      return JSON.stringify({
        ...parsed,
        deliveryContent: maskCode(parsed.deliveryContent),
        codesMasked: true,
      });
    }
  } catch {
    /* texto livre */
  }
  return content;
}

function maskChatMessagesForViewer(messages, { revealCodes }) {
  if (revealCodes || !Array.isArray(messages)) return messages;
  return messages.map((msg) => {
    if (msg?.type !== 'DELIVERY') return msg;
    return {
      ...msg,
      content: maskDeliveryMessageContent(msg.content),
    };
  });
}

function maskOrderCodesForViewer(order, { revealCodes }) {
  if (revealCodes || !order?.items) return order;
  return {
    ...order,
    items: order.items.map((item) => ({
      ...item,
      codes: Array.isArray(item.codes)
        ? item.codes.map((c) => ({
            ...c,
            code: maskCode(c.code),
            codeMasked: true,
          }))
        : item.codes,
    })),
  };
}

function maskAdminChatPayload(chat, { revealCodes }) {
  if (!chat || revealCodes) return chat;
  return {
    ...chat,
    messages: maskChatMessagesForViewer(chat.messages, { revealCodes: false }),
    order: chat.order ? maskOrderCodesForViewer(chat.order, { revealCodes: false }) : chat.order,
  };
}

module.exports = {
  maskCode,
  maskEmail,
  maskDeliveryMessageContent,
  maskChatMessagesForViewer,
  maskOrderCodesForViewer,
  maskAdminChatPayload,
};
