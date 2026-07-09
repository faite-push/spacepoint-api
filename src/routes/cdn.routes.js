const { Router } = require('express');
const router = Router();
const multer = require('multer');

const requireAdmin = require('../middleware/adminMiddleware');
const authenticate = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const CdnController = require('../controllers/cdn.controllers');

const upload = multer({ dest: 'temp_uploads/', limits: { fileSize: 100 * 1024 * 1024 } });
const chatUpload = multer({
  dest: 'temp_uploads/',
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
});

router.get('/cdn/:filename', CdnController.getFile);
router.post('/v1/cdn/upload', authenticate, requireAdmin, requirePermission('media:manage'), upload.single('file'), CdnController.uploadFile);
router.post('/v1/cdn/upload/chat', authenticate, chatUpload.single('file'), CdnController.uploadFile);
router.delete('/v1/cdn/:filename', authenticate, requireAdmin, requirePermission('media:manage'), CdnController.deleteFile);

// Admin Gallery Endpoints
router.get('/v2/api/admin/media', authenticate, requireAdmin, requirePermission('media:view'), CdnController.listMedia);
router.delete('/v2/api/admin/media/:filename', authenticate, requireAdmin, requirePermission('media:manage'), CdnController.deleteFile);

module.exports = router;