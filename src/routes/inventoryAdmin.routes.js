const { Router } = require('express');
const router = Router();

const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');
const InventoryAdminController = require('../controllers/inventoryAdmin.controllers');

const guard = [authenticate, requireAdmin];

router.get(
  '/v2/api/admin/inventory',
  ...guard,
  requirePermission('products:view'),
  (req, res) => InventoryAdminController.list(req, res)
);

router.get(
  '/v2/api/admin/inventory/variants/:variantId/codes',
  ...guard,
  requirePermission('products:view'),
  (req, res) => InventoryAdminController.listCodes(req, res)
);

router.post(
  '/v2/api/admin/inventory/variants/:variantId/codes/bulk',
  ...guard,
  requirePermission('products:edit'),
  (req, res) => InventoryAdminController.bulkUploadCodes(req, res)
);

router.patch(
  '/v2/api/admin/inventory/variants/:variantId/stock',
  ...guard,
  requirePermission('products:edit'),
  (req, res) => InventoryAdminController.updateManualStock(req, res)
);

router.delete(
  '/v2/api/admin/inventory/codes/:codeId',
  ...guard,
  requirePermission('products:edit'),
  (req, res) => InventoryAdminController.removeCode(req, res)
);

module.exports = router;
