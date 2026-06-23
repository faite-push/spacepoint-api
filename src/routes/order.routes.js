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
router.get('/v2/api/orders/payment-options', authenticate, OrderController.paymentOptions.bind(OrderController));
router.get('/v2/api/orders/:id', authenticate, OrderController.getOneForCustomer.bind(OrderController));
router.post('/v2/api/orders', authenticate, csrf, checkoutLimiter, OrderController.create.bind(OrderController));
router.get('/v2/api/admin/orders', authenticate, requireAdmin, requirePermission('orders:view'), OrderController.listAll.bind(OrderController));
router.get('/v2/api/admin/orders/:id', authenticate, requireAdmin, requirePermission('orders:view'), OrderController.getOne.bind(OrderController));
router.patch('/v2/api/admin/orders/bulk-status', authenticate, requireAdmin, requirePermission('orders:manage'), csrf, OrderController.bulkUpdateStatus.bind(OrderController));
router.patch('/v2/api/admin/orders/:id/status', authenticate, requireAdmin, requirePermission('orders:manage'), csrf, OrderController.updateStatus.bind(OrderController));
router.patch('/v2/api/admin/orders/:id/notes', authenticate, requireAdmin, requirePermission('orders:manage'), csrf, OrderController.updateNotes.bind(OrderController));
router.post('/v2/api/admin/orders/:id/mark-paid', authenticate, requireAdmin, requirePermission('orders:manage'), csrf, OrderController.markPaidAndDeliver.bind(OrderController));

module.exports = router;
