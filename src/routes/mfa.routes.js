const { Router } = require('express');
const router = Router();

const AdminAuthController = require('../controllers/adminAuth.controllers');
const { adminLoginLimiter, adminMfaLimiter } = require('../middleware/authRateLimit');

router.post('/v2/api/admin/auth/login', adminLoginLimiter, AdminAuthController.login.bind(AdminAuthController));
router.post('/v2/api/admin/auth/mfa/setup', adminMfaLimiter, AdminAuthController.mfaSetup.bind(AdminAuthController));
router.post('/v2/api/admin/auth/mfa/verify', adminMfaLimiter, AdminAuthController.mfaVerify.bind(AdminAuthController));
router.post('/v2/api/admin/auth/logout', AdminAuthController.logout.bind(AdminAuthController));

module.exports = router;
