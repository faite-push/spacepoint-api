const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const optionalAuthenticate = require('../middleware/optionalAuthenticate');
const ProductInterestController = require('../controllers/productInterest.controllers');

const router = Router();

const viewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas visualizações. Tente novamente em breve.' },
});

router.post(
  '/v2/api/product-interest/view',
  viewLimiter,
  optionalAuthenticate,
  ProductInterestController.trackView.bind(ProductInterestController)
);

module.exports = router;
