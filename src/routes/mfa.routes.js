const { Router } = require('express');
const router = Router();

const AdminAuthController = require('../controllers/adminAuth.controllers');

router.post('/v2/api/admin/auth/login', AdminAuthController.login.bind(AdminAuthController));
router.post('/v2/api/admin/auth/mfa/setup', AdminAuthController.mfaSetup.bind(AdminAuthController));
router.post('/v2/api/admin/auth/mfa/verify', AdminAuthController.mfaVerify.bind(AdminAuthController));
router.post('/v2/api/admin/auth/logout', AdminAuthController.logout.bind(AdminAuthController));

module.exports = router;

