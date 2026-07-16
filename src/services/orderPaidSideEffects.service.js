const { queueDiscordOrderPaid } = require('./discordOrders.service');
const { queueServerPurchase } = require('./conversionsApi.service');

/**
 * Efeitos assíncronos após confirmação de pagamento (além de e-mail/chat).
 * Idempotente por flags em Payment.metadata.
 */
function emitOrderPaidSideEffects(orderId) {
  if (!orderId) return;
  queueDiscordOrderPaid(orderId);
  queueServerPurchase(orderId);
}

module.exports = {
  emitOrderPaidSideEffects,
};
