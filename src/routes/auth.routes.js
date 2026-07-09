const { Router } = require('express');
const router = Router();

const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');
const csrf = require('../middleware/csrfMiddleware');
const AuthController = require('../controllers/auth.controllers');
const UserController = require('../controllers/user.controllers');
const RoleController = require('../controllers/roles.controllers');
const {
  otpSendLimiter,
  otpVerifyLimiter,
} = require('../middleware/authRateLimit');

router.get('/login/discord', AuthController.redirectDiscord.bind(AuthController));
router.get('/login/discord/callback', AuthController.callbackDiscord.bind(AuthController));

router.get('/login/google', AuthController.redirectGoogle.bind(AuthController));
router.get('/login/google/callback', AuthController.callbackGoogle.bind(AuthController));

router.get('/v2/api/request/me', authenticate, AuthController.getMe.bind(AuthController));
router.get('/logout', AuthController.logout.bind(AuthController));

router.get('/v2/api/admin/check', authenticate, requireAdmin, AuthController.checkAdmin.bind(AuthController));
router.get('/v2/api/admin/team', authenticate, requireAdmin, requirePermission('users:view'), UserController.getTeam.bind(UserController));
router.get('/v2/api/admin/users/search', authenticate, requireAdmin, requirePermission('users:view'), UserController.searchUsers.bind(UserController));
router.get('/v2/api/admin/users', authenticate, requireAdmin, requirePermission('users:view'), UserController.getAllUsers.bind(UserController));
router.get('/v2/api/admin/users/:id', authenticate, requireAdmin, requirePermission('users:view'), UserController.getUserById.bind(UserController));
router.post('/v2/api/admin/users/:id/toggle-admin', authenticate, requireAdmin, csrf, requirePermission('roles:manage'), UserController.toggleAdmin.bind(UserController));
router.put('/api/admin/roles/reorder', authenticate, requireAdmin, csrf, requirePermission('roles:manage'), RoleController.reorderRoles.bind(RoleController));

router.post('/api/auth/send-code', otpSendLimiter, AuthController.sendOtpCode.bind(AuthController));
router.post('/api/auth/verify-code', otpVerifyLimiter, AuthController.verifyOtpCode.bind(AuthController));

// ─── Roles & Permissions (RBAC) ──────────────────────────────────────────────

// Permissions
router.get('/api/admin/permissions', authenticate, requireAdmin, requirePermission('roles:view'), RoleController.getAllPermissions.bind(RoleController));

// Roles CRUD
router.get('/api/admin/roles', authenticate, requireAdmin, requirePermission('roles:view'), RoleController.getAllRoles.bind(RoleController));
router.get('/api/admin/roles/:id', authenticate, requireAdmin, requirePermission('roles:view'), RoleController.getRoleById.bind(RoleController));
router.post('/api/admin/roles', authenticate, requireAdmin, csrf, requirePermission('roles:manage'), RoleController.createRole.bind(RoleController));
router.put('/api/admin/roles/:id', authenticate, requireAdmin, csrf, requirePermission('roles:manage'), RoleController.updateRole.bind(RoleController));
router.delete('/api/admin/roles/:id', authenticate, requireAdmin, csrf, requirePermission('roles:manage'), RoleController.deleteRole.bind(RoleController));

// User Role Management
router.post('/api/admin/users/:userId/role', authenticate, requireAdmin, csrf, requirePermission('roles:manage'), RoleController.assignRoleToUser.bind(RoleController));
router.get('/api/admin/users/:userId/permissions', authenticate, requireAdmin, requirePermission('roles:view'), RoleController.getUserPermissions.bind(RoleController));

// Permission Check
router.get('/api/admin/check-permission/:permission', authenticate, RoleController.checkPermission.bind(RoleController));

module.exports = router;