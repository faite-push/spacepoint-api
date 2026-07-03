const { Router } = require('express');
const router = Router();

const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const GatewayController = require('../controllers/gateway.controllers');

const guard = [authenticate, requireAdmin, requirePermission('gateways:manage')];

router.get('/v2/api/admin/gateways', ...guard, GatewayController.list);
router.post('/v2/api/admin/gateways/:slug/validate', ...guard, GatewayController.validate);
router.put('/v2/api/admin/gateways/:slug', ...guard, GatewayController.update);
router.patch('/v2/api/admin/gateways/:slug/toggle', ...guard, GatewayController.toggle);
router.patch('/v2/api/admin/gateways/:slug/toggle-method', ...guard, GatewayController.toggleMethod);

module.exports = router;
