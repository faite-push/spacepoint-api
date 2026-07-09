const { Router } = require('express');
const PaymentController = require('../controllers/payment.controllers');
const authenticate = require('../middleware/authMiddleware');
const { webhookLimiter } = require('../middleware/authRateLimit');

const router = Router();

router.post('/v1/webhooks/efi/pix', webhookLimiter, PaymentController.efiWebhook.bind(PaymentController));
router.post('/v1/webhooks/mercado-pago', webhookLimiter, PaymentController.mercadoPagoWebhook.bind(PaymentController));
router.get('/v1/webhooks/mercado-pago', webhookLimiter, PaymentController.mercadoPagoWebhook.bind(PaymentController));
router.post('/v1/webhooks/pagbank', webhookLimiter, PaymentController.pagbankWebhook.bind(PaymentController));
router.get('/v1/webhooks/pagbank', webhookLimiter, PaymentController.pagbankWebhook.bind(PaymentController));
router.post('/v1/webhooks/stripe', webhookLimiter, PaymentController.stripeWebhook.bind(PaymentController));

router.post(
  '/v2/api/payments/:id/verify',
  authenticate,
  PaymentController.verifyPayment.bind(PaymentController)
);

router.post(
  '/v2/api/orders/:orderId/payment/verify',
  authenticate,
  PaymentController.verifyOrderPayment.bind(PaymentController)
);

module.exports = router;
