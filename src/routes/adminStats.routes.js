const { Router } = require('express');
const router = Router();

const requireAdmin = require('../middleware/adminMiddleware');
const authenticate = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const AdminStatsController = require('../controllers/adminStats.controllers');

router.get(
  '/v2/api/admin/stats',
  authenticate,
  requireAdmin,
  requirePermission('analytics:view'),
  (req, res) => AdminStatsController.overview(req, res)
);

module.exports = router;
