const { Router } = require("express");
const router = Router();

const authenticate = require("../middleware/authMiddleware");
const requireAdmin = require("../middleware/adminMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");
const ProductVariantController = require("../controllers/productVariant.controllers");

const guard = [authenticate, requireAdmin];

router.get("/v2/api/admin/products/:productId/variants", ...guard, requirePermission('products:view'), (req, res) => ProductVariantController.list(req, res));
router.post("/v2/api/admin/products/:productId/variants/bulk-generate", ...guard, requirePermission('products:create'), (req, res) => ProductVariantController.bulkGenerate(req, res));
router.post("/v2/api/admin/products/:productId/variants", ...guard, requirePermission('products:create'), (req, res) => ProductVariantController.create(req, res));
router.post("/v2/api/admin/products/:productId/variants/:variantId/duplicate", ...guard, requirePermission('products:create'), (req, res) => ProductVariantController.duplicate(req, res));
router.put("/v2/api/admin/products/:productId/variants/reorder", ...guard, requirePermission('products:edit'), (req, res) => ProductVariantController.reorder(req, res));
router.get("/v2/api/admin/products/:productId/variants/:variantId", ...guard, requirePermission('products:view'), (req, res) => ProductVariantController.get(req, res));
router.put("/v2/api/admin/products/:productId/variants/:variantId", ...guard, requirePermission('products:edit'), (req, res) => ProductVariantController.update(req, res));
router.delete("/v2/api/admin/products/:productId/variants/:variantId", ...guard, requirePermission('products:delete'), (req, res) => ProductVariantController.remove(req, res));

module.exports = router;
