const { Router } = require('express');
const router = Router();

const requireAdmin = require('../middleware/adminMiddleware');
const authenticate = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const CategoryController = require('../controllers/category.controllers');

// Admin
router.get('/v2/api/admin/categories', authenticate, requireAdmin, requirePermission('products:view'), (req, res) => CategoryController.list(req, res));
router.post('/v2/api/admin/categories', authenticate, requireAdmin, requirePermission('products:create'), (req, res) => CategoryController.create(req, res));
router.put('/v2/api/admin/categories/reorder', authenticate, requireAdmin, requirePermission('products:edit'), (req, res) => CategoryController.reorder(req, res));
router.get('/v2/api/admin/categories/:id', authenticate, requireAdmin, requirePermission('products:view'), (req, res) => CategoryController.getById(req, res));
router.put('/v2/api/admin/categories/:id', authenticate, requireAdmin, requirePermission('products:edit'), (req, res) => CategoryController.update(req, res));
router.delete('/v2/api/admin/categories/:id', authenticate, requireAdmin, requirePermission('products:delete'), (req, res) => CategoryController.remove(req, res));

// Público (para navbar/listagens da loja)
router.get('/v2/api/categories', (req, res) => CategoryController.listPublic(req, res));
router.get('/v2/api/categories/:slug', (req, res) => CategoryController.getBySlugPublic(req, res));

module.exports = router;
