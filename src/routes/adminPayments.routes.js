const { Router } = require('express');
const router = Router();

const requireAdmin = require('../middleware/adminMiddleware');
const authenticate = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const AdminPaymentsController = require('../controllers/adminPayments.controllers');

router.get(
  '/v2/api/admin/payments',
  authenticate,
  requireAdmin,
  requirePermission('orders:view'),
  (req, res) => AdminPaymentsController.list(req, res)
);

router.get(
  '/v2/api/admin/payments/:id',
  authenticate,
  requireAdmin,
  requirePermission('orders:view'),
  (req, res) => AdminPaymentsController.details(req, res)
);

router.patch(
  '/v2/api/admin/payments/:id/refund',
  authenticate,
  requireAdmin,
  requirePermission('orders:refund'),
  (req, res) => AdminPaymentsController.refund(req, res)
);

module.exports = router;
