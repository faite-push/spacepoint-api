const cron = require('node-cron');
const { prisma } = require('../config/prisma');
const { expireStalePendingOrders } = require('./orderFulfillment.service');
const { getReviewsSettings } = require('../utils/reviewsSettings');
const { getAbandonedCartSettings, isWithinNotificationWindow } = require('../utils/abandonedCartSettings');
const orderEmailService = require('./orderEmail.service');
const cartService = require('./cart.service');
const abandonedCartEmailService = require('./abandonedCartEmail.service');

async function sendReviewReminders() {
  const settings = await getReviewsSettings(prisma);
  if (!settings.enabled || settings.sendReviewInviteEmail === false) return 0;

  const hours = settings.reviewReminderHours || 24;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      status: 'DELIVERED',
      deliveredAt: { lte: cutoff },
      chat: {
        rating: null,
        reviewReminderSentAt: null,
      },
    },
    select: { id: true },
    take: 50,
  });

  for (const { id } of orders) {
    orderEmailService.notifyReviewReminder(id);
  }

  return orders.length;
}

async function sendAbandonedCartReminders() {
  const settings = await getAbandonedCartSettings(prisma);
  if (!settings.enabled || settings.sendRecoveryEmail === false || settings.cartSendMode === 'manual') {
    return 0;
  }
  if (!isWithinNotificationWindow(settings)) return 0;

  const delayHours =
    Array.isArray(settings.cartEmailDelays) && settings.cartEmailDelays.length
      ? Math.min(...settings.cartEmailDelays)
      : settings.delayHours;

  const cartIds = await cartService.listRecoverableCartIds({
    delayHours,
    inactivityMinutes: settings.inactivityMinutes,
    minSubtotalCents: settings.minSubtotalCents,
    limit: 50,
  });

  for (const cartId of cartIds) {
    abandonedCartEmailService.notifyAbandonedCartRecovery(cartId);
  }

  return cartIds.length;
}

function init() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const count = await expireStalePendingOrders();
      if (count > 0) {
        console.log(`[cron] ${count} pedido(s) pendente(s) expirado(s)`);
      }
    } catch (err) {
      console.error('[cron] expireStalePendingOrders', err.message);
    }
  });

  cron.schedule('0 * * * *', async () => {
    try {
      const count = await sendReviewReminders();
      if (count > 0) {
        console.log(`[cron] ${count} lembrete(s) de avaliação enfileirado(s)`);
      }
    } catch (err) {
      console.error('[cron] sendReviewReminders', err.message);
    }
  });

  cron.schedule('15 * * * *', async () => {
    try {
      const count = await sendAbandonedCartReminders();
      if (count > 0) {
        console.log(`[cron] ${count} e-mail(s) de carrinho abandonado enfileirado(s)`);
      }
    } catch (err) {
      console.error('[cron] sendAbandonedCartReminders', err.message);
    }
  });
}

module.exports = { init, sendReviewReminders, sendAbandonedCartReminders };
