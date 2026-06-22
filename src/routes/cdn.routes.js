const { Router } = require('express');
const router = Router();
const multer = require('multer');

const requireAdmin = require('../middleware/adminMiddleware');
const authenticate = require('../middleware/authMiddleware');

const CdnController = require('../controllers/cdn.controllers');

const upload = multer({ dest: 'temp_uploads/', limits: { fileSize: 100 * 1024 * 1024 } });

router.get('/cdn/:filename', CdnController.getFile);
router.post('/v1/cdn/upload', authenticate, requireAdmin, upload.single('file'), CdnController.uploadFile);
router.delete('/v1/cdn/:filename', authenticate, requireAdmin, CdnController.deleteFile);

// Admin Gallery Endpoints
router.get('/v2/api/admin/media', authenticate, requireAdmin, CdnController.listMedia);
router.delete('/v2/api/admin/media/:filename', authenticate, requireAdmin, CdnController.deleteFile);

module.exports = router;