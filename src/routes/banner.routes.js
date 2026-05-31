const { Router } = require('express');
const BannerController = require('../controllers/banner.controllers');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const router = Router();

router.get('/v2/api/admin/banners', authenticate, requireAdmin, requirePermission('settings:manage'), BannerController.list.bind(BannerController));
router.post('/v2/api/admin/banners', authenticate, requireAdmin, requirePermission('settings:manage'), BannerController.create.bind(BannerController));
router.put('/v2/api/admin/banners/reorder', authenticate, requireAdmin, requirePermission('settings:manage'), BannerController.reorder.bind(BannerController));
router.put('/v2/api/admin/banners/:id', authenticate, requireAdmin, requirePermission('settings:manage'), BannerController.update.bind(BannerController));
router.delete('/v2/api/admin/banners/:id', authenticate, requireAdmin, requirePermission('settings:manage'), BannerController.delete.bind(BannerController));

module.exports = router;
