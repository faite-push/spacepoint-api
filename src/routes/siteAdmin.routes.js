const { Router } = require('express');
const SiteAdminController = require('../controllers/siteAdmin.controllers');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const router = Router();
const settingsGuard = [
  authenticate,
  requireAdmin,
  requirePermission.any(
    'settings:manage',
    'pages:manage',
    'plugins:manage',
    'reviews:view',
    'reviews:manage'
  ),
];
const pagesGuard = [authenticate, requireAdmin, requirePermission('pages:manage')];

router.get('/v2/api/admin/site-settings', ...settingsGuard, SiteAdminController.getSettings.bind(SiteAdminController));
router.put('/v2/api/admin/site-settings', ...settingsGuard, SiteAdminController.updateSettings.bind(SiteAdminController));
router.get(
  '/v2/api/admin/institutional-pages',
  ...pagesGuard,
  SiteAdminController.listInstitutionalPages.bind(SiteAdminController)
);
router.put(
  '/v2/api/admin/institutional-pages/:slug',
  ...pagesGuard,
  SiteAdminController.updateInstitutionalPage.bind(SiteAdminController)
);

module.exports = router;
