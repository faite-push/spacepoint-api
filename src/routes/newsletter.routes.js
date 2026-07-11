const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');
const optionalAuthenticate = require('../middleware/optionalAuthenticate');
const NewsletterController = require('../controllers/newsletter.controllers');

const router = Router();

const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de inscrição. Tente novamente em breve.' },
});

const adminGuard = [authenticate, requireAdmin, requirePermission('settings:manage')];

router.post(
  '/v2/api/newsletter/subscribe',
  subscribeLimiter,
  optionalAuthenticate,
  NewsletterController.subscribe.bind(NewsletterController)
);

router.get(
  '/v2/api/admin/newsletter/subscribers',
  ...adminGuard,
  NewsletterController.listSubscribers.bind(NewsletterController)
);

router.delete(
  '/v2/api/admin/newsletter/subscribers/:id',
  ...adminGuard,
  NewsletterController.removeSubscriber.bind(NewsletterController)
);

router.get(
  '/v2/api/admin/newsletter/subscribers/export',
  ...adminGuard,
  NewsletterController.exportSubscribers.bind(NewsletterController)
);

module.exports = router;
