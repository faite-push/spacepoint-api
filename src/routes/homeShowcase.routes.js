const { Router } = require('express');
const HomeShowcaseController = require('../controllers/homeShowcase.controllers');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const router = Router();
const guard = [authenticate, requireAdmin, requirePermission('pages:manage')];

router.get('/v2/api/home-showcase', HomeShowcaseController.listPublic.bind(HomeShowcaseController));

router.get(
  '/v2/api/admin/home-showcase-sections',
  ...guard,
  HomeShowcaseController.listAdmin.bind(HomeShowcaseController)
);
router.get(
  '/v2/api/admin/home-showcase/featured-products',
  ...guard,
  HomeShowcaseController.listFeaturedProducts.bind(HomeShowcaseController)
);
router.post(
  '/v2/api/admin/home-showcase-sections',
  ...guard,
  HomeShowcaseController.create.bind(HomeShowcaseController)
);
router.put(
  '/v2/api/admin/home-showcase-sections/reorder',
  ...guard,
  HomeShowcaseController.reorder.bind(HomeShowcaseController)
);
router.put(
  '/v2/api/admin/home-showcase-sections/:id',
  ...guard,
  HomeShowcaseController.update.bind(HomeShowcaseController)
);
router.delete(
  '/v2/api/admin/home-showcase-sections/:id',
  ...guard,
  HomeShowcaseController.remove.bind(HomeShowcaseController)
);

module.exports = router;
