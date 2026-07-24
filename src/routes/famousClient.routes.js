const { Router } = require('express');
const FamousClientController = require('../controllers/famousClient.controllers');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const router = Router();
const guard = [authenticate, requireAdmin, requirePermission('pages:manage')];

router.get('/v2/api/famous-clients', FamousClientController.listPublic.bind(FamousClientController));

router.get('/v2/api/admin/famous-clients', ...guard, FamousClientController.listAdmin.bind(FamousClientController));
router.post('/v2/api/admin/famous-clients', ...guard, FamousClientController.create.bind(FamousClientController));
router.put('/v2/api/admin/famous-clients/reorder', ...guard, FamousClientController.reorder.bind(FamousClientController));
router.put('/v2/api/admin/famous-clients/:id', ...guard, FamousClientController.update.bind(FamousClientController));
router.delete('/v2/api/admin/famous-clients/:id', ...guard, FamousClientController.remove.bind(FamousClientController));

module.exports = router;
