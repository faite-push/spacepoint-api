const { Router } = require('express');
const SiteAdminController = require('../controllers/siteAdmin.controllers');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const router = Router();
const guard = [authenticate, requireAdmin, requirePermission('settings:manage')];

router.get('/v2/api/admin/site-settings', ...guard, SiteAdminController.getSettings.bind(SiteAdminController));
router.put('/v2/api/admin/site-settings', ...guard, SiteAdminController.updateSettings.bind(SiteAdminController));
router.get(
  '/v2/api/admin/institutional-pages',
  ...guard,
  SiteAdminController.listInstitutionalPages.bind(SiteAdminController)
);
router.put(
  '/v2/api/admin/institutional-pages/:slug',
  ...guard,
  SiteAdminController.updateInstitutionalPage.bind(SiteAdminController)
);

module.exports = router;
