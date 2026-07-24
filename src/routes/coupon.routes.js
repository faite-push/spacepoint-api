const { Router } = require('express');
const router = Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const couponController = require('../controllers/coupon.controllers');
const requireAdmin = require('../middleware/adminMiddleware');
const authenticate = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const validateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  message: { error: 'Muitas tentativas de validação de cupom. Tente novamente em alguns minutos.' },
});

// Validação pública (preview no carrinho); desconto real só no create order
router.get('/v2/api/coupons/validate', validateLimiter, couponController.validate);

const adminGuard = [authenticate, requireAdmin];

router.get('/v2/api/admin/coupons', ...adminGuard, requirePermission('coupons:view'), couponController.list);
router.get('/v2/api/admin/coupons/stats', ...adminGuard, requirePermission('coupons:view'), couponController.stats);
router.get('/v2/api/admin/coupons/:id', ...adminGuard, requirePermission('coupons:view'), couponController.get);
router.post('/v2/api/admin/coupons', ...adminGuard, requirePermission('coupons:manage'), couponController.create);
router.patch('/v2/api/admin/coupons/:id', ...adminGuard, requirePermission('coupons:manage'), couponController.update);
router.delete('/v2/api/admin/coupons/:id', ...adminGuard, requirePermission('coupons:manage'), couponController.delete);
router.post('/v2/api/admin/coupons/:id/duplicate', ...adminGuard, requirePermission('coupons:manage'), couponController.duplicate);

module.exports = router;
