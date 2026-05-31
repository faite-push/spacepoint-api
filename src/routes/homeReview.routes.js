const { Router } = require('express');
const HomeReviewController = require('../controllers/homeReview.controllers');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const router = Router();
const guard = [authenticate, requireAdmin, requirePermission('settings:manage')];

router.get('/v2/api/home-reviews', HomeReviewController.listPublic.bind(HomeReviewController));
router.get('/v2/api/page-seo/:pageKey', HomeReviewController.getPageSeoPublic.bind(HomeReviewController));

router.get('/v2/api/admin/home-reviews', ...guard, HomeReviewController.listAdmin.bind(HomeReviewController));
router.post('/v2/api/admin/home-reviews', ...guard, HomeReviewController.create.bind(HomeReviewController));
router.put('/v2/api/admin/home-reviews/reorder', ...guard, HomeReviewController.reorder.bind(HomeReviewController));
router.put('/v2/api/admin/home-reviews/:id', ...guard, HomeReviewController.update.bind(HomeReviewController));
router.delete('/v2/api/admin/home-reviews/:id', ...guard, HomeReviewController.remove.bind(HomeReviewController));

router.get('/v2/api/admin/page-seo', ...guard, HomeReviewController.listPageSeo.bind(HomeReviewController));
router.put('/v2/api/admin/page-seo/:pageKey', ...guard, HomeReviewController.updatePageSeo.bind(HomeReviewController));

module.exports = router;
