const { Router } = require('express');
const router = Router();

router.get('/', (req, res) => { res.status(202).json({ status: 'online', version: '1.0.0' }) });

module.exports = router;