const { Router } = require('express');
const PaymentController = require('../controllers/payment.controllers');
const authenticate = require('../middleware/authMiddleware');

const router = Router();

router.post('/v1/webhooks/efi/pix', PaymentController.efiWebhook.bind(PaymentController));
router.post('/v1/webhooks/mercado-pago', PaymentController.mercadoPagoWebhook.bind(PaymentController));
router.get('/v1/webhooks/mercado-pago', PaymentController.mercadoPagoWebhook.bind(PaymentController));
router.post('/v1/webhooks/pagbank', PaymentController.pagbankWebhook.bind(PaymentController));
router.get('/v1/webhooks/pagbank', PaymentController.pagbankWebhook.bind(PaymentController));
router.post('/v1/webhooks/stripe', PaymentController.stripeWebhook.bind(PaymentController));

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
