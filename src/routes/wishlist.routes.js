const { Router } = require('express');
const authenticate = require('../middleware/authMiddleware');
const csrf = require('../middleware/csrfMiddleware');
const WishlistController = require('../controllers/wishlist.controllers');

const router = Router();

router.get('/v2/api/wishlist/me', authenticate, WishlistController.listMine.bind(WishlistController));
router.post('/v2/api/wishlist/sync', authenticate, csrf, WishlistController.sync.bind(WishlistController));
router.post('/v2/api/wishlist', authenticate, csrf, WishlistController.add.bind(WishlistController));
router.delete(
  '/v2/api/wishlist/:productId',
  authenticate,
  csrf,
  WishlistController.remove.bind(WishlistController)
);

module.exports = router;
