const express = require('express');
const { rateLimit } = require('express-rate-limit');
const AnalyticsController = require('../controllers/analytics.controllers');
const optionalAuthenticate = require('../middleware/optionalAuthenticate');

const router = express.Router();

const visitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de rastreamento atingido.' },
});

router.post(
  '/v2/api/analytics/visit',
  visitLimiter,
  optionalAuthenticate,
  AnalyticsController.trackVisit.bind(AnalyticsController)
);

module.exports = router;
