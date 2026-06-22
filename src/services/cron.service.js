const cron = require('node-cron');
const { expireStalePendingOrders } = require('./orderFulfillment.service');

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
}

module.exports = { init };
