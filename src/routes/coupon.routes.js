const { Router } = require('express');
const router = Router();

const couponController = require('../controllers/coupon.controllers');
const requireAdmin = require('../middleware/adminMiddleware');
const authenticate = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

router.get('/v2/api/coupons/validate', couponController.validate);

const adminGuard = [authenticate, requireAdmin];

router.get('/v2/api/admin/coupons', ...adminGuard, requirePermission('coupons:view'), couponController.list);
router.get('/v2/api/admin/coupons/stats', ...adminGuard, requirePermission('coupons:view'), couponController.stats);
router.get('/v2/api/admin/coupons/:id', ...adminGuard, requirePermission('coupons:view'), couponController.get);
router.post('/v2/api/admin/coupons', ...adminGuard, requirePermission('coupons:manage'), couponController.create);
router.patch('/v2/api/admin/coupons/:id', ...adminGuard, requirePermission('coupons:manage'), couponController.update);
router.delete('/v2/api/admin/coupons/:id', ...adminGuard, requirePermission('coupons:manage'), couponController.delete);
router.post('/v2/api/admin/coupons/:id/duplicate', ...adminGuard, requirePermission('coupons:manage'), couponController.duplicate);

module.exports = router;
