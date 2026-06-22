const {
  handleEfiWebhook,
  handleMercadoPagoWebhook,
  handlePagBankWebhook,
  handleStripeWebhook,
  verifyAndFulfillPixByTxid,
  verifyAndFulfillPayment,
  syncPendingOrderPayment,
} = require('../services/payment.service');
const { prisma } = require('../config/prisma');

class PaymentController {
  async efiWebhook(req, res) {
    try {
      res.status(200).json({ received: true });

      const body = req.body;
      if (body?.pix) {
        await handleEfiWebhook(body);
        return;
      }

      if (body?.txid) {
        await verifyAndFulfillPixByTxid(body.txid);
      }
    } catch (err) {
      console.error('[PaymentController.efiWebhook]', err);
    }
  }

  async mercadoPagoWebhook(req, res) {
    try {
      res.status(200).send('OK');
      await handleMercadoPagoWebhook(req.body || {}, req.query || {});
    } catch (err) {
      console.error('[PaymentController.mercadoPagoWebhook]', err);
    }
  }

  async pagbankWebhook(req, res) {
    try {
      res.status(200).json({ received: true });
      const payload = { ...(req.query || {}), ...(req.body || {}) };
      await handlePagBankWebhook(payload);
    } catch (err) {
      console.error('[PaymentController.pagbankWebhook]', err);
    }
  }

  async stripeWebhook(req, res) {
    try {
      res.status(200).json({ received: true });
      await handleStripeWebhook(req.body);
    } catch (err) {
      console.error('[PaymentController.stripeWebhook]', err);
    }
  }

  async verifyPayment(req, res) {
    try {
      const { id } = req.params;
      const payment = await prisma.payment.findFirst({
        where: { id, order: { userId: req.user.id } },
      });
      if (!payment) {
        return res.status(404).json({ error: 'Pagamento não encontrado' });
      }
      const fulfilled = await verifyAndFulfillPayment(payment);
      return res.json({ fulfilled });
    } catch (err) {
      console.error('[PaymentController.verifyPayment]', err);
      return res.status(400).json({ error: err.message });
    }
  }

  async verifyOrderPayment(req, res) {
    try {
      const orderId = req.params.orderId;
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== req.user.id) {
        return res.status(404).json({ error: 'Pedido não encontrado' });
      }
      const fulfilled = await syncPendingOrderPayment(orderId);
      const updated = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: { select: { name: true, imageUrl: true, slug: true, price: true } },
            },
          },
        },
      });
      return res.json({ fulfilled, order: updated });
    } catch (err) {
      console.error('[PaymentController.verifyOrderPayment]', err);
      return res.status(400).json({ error: err.message });
    }
  }
}

module.exports = new PaymentController();
