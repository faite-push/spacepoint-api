const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');
const csrf = require('../middleware/csrfMiddleware');
const OrderController = require('../controllers/order.controllers');

const router = Router();

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de checkout. Tente novamente em breve.' },
});

router.get('/v2/api/orders/me', authenticate, OrderController.listMine.bind(OrderController));
router.post('/v2/api/orders', authenticate, csrf, checkoutLimiter, OrderController.create.bind(OrderController));
router.post('/v2/api/admin/orders/:id/mark-paid', authenticate, requireAdmin, requirePermission('orders:manage'), csrf, OrderController.markPaidAndDeliver.bind(OrderController));

module.exports = router;
