const { Router } = require('express');
const router = Router();

const requireAdmin = require('../middleware/adminMiddleware');
const authenticate = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const ProductAdminController = require('../controllers/productAdmin.controllers');

router.get('/v2/api/admin/products', authenticate, requireAdmin, requirePermission('products:view'), (req, res) => ProductAdminController.list(req, res));
router.get('/v2/api/admin/products/:id', authenticate, requireAdmin, requirePermission('products:view'), (req, res) => ProductAdminController.getById(req, res));
router.post('/v2/api/admin/products', authenticate, requireAdmin, requirePermission('products:create'), (req, res) => ProductAdminController.create(req, res));
router.put('/v2/api/admin/products/reorder', authenticate, requireAdmin, requirePermission('products:edit'), (req, res) => ProductAdminController.reorder(req, res));
router.put('/v2/api/admin/products/:id', authenticate, requireAdmin, requirePermission('products:edit'), (req, res) => ProductAdminController.update(req, res));
router.post('/v2/api/admin/products/:id/convert-to-variant', authenticate, requireAdmin, requirePermission('products:edit'), (req, res) => ProductAdminController.convertToVariant(req, res));
router.delete('/v2/api/admin/products/:id', authenticate, requireAdmin, requirePermission('products:delete'), (req, res) => ProductAdminController.remove(req, res));

module.exports = router;
