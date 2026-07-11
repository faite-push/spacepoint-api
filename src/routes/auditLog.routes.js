const { Router } = require('express');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');
const AuditLogController = require('../controllers/auditLog.controllers');

const router = Router();

const auditGuard = [authenticate, requireAdmin, requirePermission('audit:view')];

router.get(
  '/v2/api/admin/audit-logs',
  ...auditGuard,
  AuditLogController.list.bind(AuditLogController)
);

module.exports = router;
