const { Router } = require('express');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const csrf = require('../middleware/csrfMiddleware');
const ProductController = require('../controllers/product.controllers');

const router = Router();

router.get('/v2/api/products', ProductController.list.bind(ProductController));
router.get('/v2/api/products/id/:id/variants/:variantId', ProductController.getVariant.bind(ProductController));
router.get('/v2/api/products/:slug', ProductController.getBySlug.bind(ProductController));
// NOTE: POST /v2/api/admin/products is now handled by productAdmin.routes.js (ProductAdminController)
router.post('/v2/api/admin/products/:id/codes', authenticate, requireAdmin, csrf, ProductController.addCodes.bind(ProductController));

module.exports = router;
