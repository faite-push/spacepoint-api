const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const optionalAuthenticate = require('../middleware/optionalAuthenticate');
const CartController = require('../controllers/cart.controllers');

const router = Router();

const cartLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas atualizações de carrinho. Tente novamente em breve.' },
});

router.put(
  '/v2/api/cart/sync',
  cartLimiter,
  optionalAuthenticate,
  CartController.sync.bind(CartController)
);

router.post(
  '/v2/api/cart/email',
  cartLimiter,
  optionalAuthenticate,
  CartController.captureEmail.bind(CartController)
);

router.delete(
  '/v2/api/cart',
  cartLimiter,
  optionalAuthenticate,
  CartController.clear.bind(CartController)
);

module.exports = router;
