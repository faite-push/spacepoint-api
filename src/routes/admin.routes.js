const { Router } = require('express');
const router = Router();

const requireAdmin = require('../middleware/adminMiddleware');
const authenticate = require('../middleware/authMiddleware');

router.use('/v2/api/admin', authenticate, requireAdmin);

module.exports = router;