const { Router } = require('express');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');
const csrf = require('../middleware/csrfMiddleware');
const ClientImportController = require('../controllers/clientImport.controllers');

const router = Router();

router.post(
  '/v2/api/admin/clients/import/preview',
  authenticate,
  requireAdmin,
  requirePermission('clients:view'),
  csrf,
  ClientImportController.uploadMiddleware(),
  ClientImportController.preview.bind(ClientImportController)
);

router.post(
  '/v2/api/admin/clients/import',
  authenticate,
  requireAdmin,
  requirePermission('clients:view'),
  csrf,
  ClientImportController.uploadMiddleware(),
  ClientImportController.import.bind(ClientImportController)
);

module.exports = router;
