const cron = require('node-cron');
const { prisma } = require('../config/prisma');
const { expireStalePendingOrders } = require('./orderFulfillment.service');
const { getReviewsSettings } = require('../utils/reviewsSettings');
const { getAbandonedCartSettings, isWithinNotificationWindow } = require('../utils/abandonedCartSettings');
const orderEmailService = require('./orderEmail.service');
const cartService = require('./cart.service');
const abandonedCartEmailService = require('./abandonedCartEmail.service');
const productInterestService = require('./productInterest.service');
const abandonedProductEmailService = require('./abandonedProductEmail.service');
const cancelledOrderEmailService = require('./cancelledOrderEmail.service');

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

  const delays =
    Array.isArray(settings.cartEmailDelays) && settings.cartEmailDelays.length
      ? settings.cartEmailDelays
      : [settings.delayHours || 1];

  const jobs = await cartService.listRecoverableCartJobs({
    delays,
    inactivityMinutes: settings.inactivityMinutes,
    minSubtotalCents: settings.minSubtotalCents,
    limit: 50,
  });

  for (const job of jobs) {
    abandonedCartEmailService.notifyAbandonedCartRecovery(job.cartId, job);
  }

  return jobs.length;
}

async function sendAbandonedProductReminders() {
  const settings = await getAbandonedCartSettings(prisma);
  if (!settings.abandonedProductEnabled) return 0;
  if (!isWithinNotificationWindow(settings)) return 0;

  const delays =
    Array.isArray(settings.abandonedProductDelays) && settings.abandonedProductDelays.length
      ? settings.abandonedProductDelays
      : [24];

  const jobs = await productInterestService.listRecoverableInterestJobs({
    delays,
    limit: 50,
  });

  for (const job of jobs) {
    abandonedProductEmailService.notifyAbandonedProductRecovery(job.interestId, job);
  }

  return jobs.length;
}

async function sendCancelledOrderReminders() {
  const settings = await getAbandonedCartSettings(prisma);
  if (!settings.cancelledOrderEnabled) return 0;
  if (!isWithinNotificationWindow(settings)) return 0;

  const delays =
    Array.isArray(settings.cancelledOrderDelays) && settings.cancelledOrderDelays.length
      ? settings.cancelledOrderDelays
      : [1];

  const jobs = await cancelledOrderEmailService.listRecoverableCancelledOrderJobs({
    delays,
    limit: 50,
  });

  for (const job of jobs) {
    cancelledOrderEmailService.notifyCancelledOrderRecovery(job.orderId, job);
  }

  return jobs.length;
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

  cron.schedule('20 * * * *', async () => {
    try {
      const count = await sendAbandonedProductReminders();
      if (count > 0) {
        console.log(`[cron] ${count} e-mail(s) de produto abandonado enfileirado(s)`);
      }
    } catch (err) {
      console.error('[cron] sendAbandonedProductReminders', err.message);
    }
  });

  cron.schedule('25 * * * *', async () => {
    try {
      const count = await sendCancelledOrderReminders();
      if (count > 0) {
        console.log(`[cron] ${count} e-mail(s) de pedido cancelado enfileirado(s)`);
      }
    } catch (err) {
      console.error('[cron] sendCancelledOrderReminders', err.message);
    }
  });
}

module.exports = {
  init,
  sendReviewReminders,
  sendAbandonedCartReminders,
  sendAbandonedProductReminders,
  sendCancelledOrderReminders,
};
