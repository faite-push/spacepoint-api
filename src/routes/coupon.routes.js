const { Router } = require('express');
const router = Router();

const couponController = require('../controllers/coupon.controllers');
const requireAdmin = require('../middleware/adminMiddleware');
const authenticate = require('../middleware/authMiddleware');

router.use('/v2/api/admin/coupons', authenticate, requireAdmin);

router.get('/v2/api/admin/coupons', couponController.list);
router.get('/v2/api/admin/coupons/stats', couponController.stats);
router.get('/v2/api/admin/coupons/:id', couponController.get);
router.post('/v2/api/admin/coupons', couponController.create);
router.patch('/v2/api/admin/coupons/:id', couponController.update);
router.delete('/v2/api/admin/coupons/:id', couponController.delete);
router.post('/v2/api/admin/coupons/:id/duplicate', couponController.duplicate);

module.exports = router;
