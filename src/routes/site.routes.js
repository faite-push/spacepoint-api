const { Router } = require('express');
const SiteController = require('../controllers/site.controllers');

const router = Router();

router.get('/v2/api/site-config', SiteController.getConfig.bind(SiteController));
router.get('/v2/api/pages/:slug', SiteController.getInstitutionalPage.bind(SiteController));
router.get('/v2/api/shop/home', SiteController.getHome.bind(SiteController));

module.exports = router;
