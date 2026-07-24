const { Router } = require('express');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');
const csrf = require('../middleware/csrfMiddleware');
const MarketingAutomationsController = require('../controllers/marketingAutomations.controllers');

const router = Router();
const admin = [authenticate, requireAdmin, requirePermission('marketing:view')];

router.get(
  '/v2/api/admin/marketing/automations/metrics',
  ...admin,
  MarketingAutomationsController.metrics.bind(MarketingAutomationsController)
);

router.get(
  '/v2/api/admin/marketing/automations/carts',
  ...admin,
  MarketingAutomationsController.listCarts.bind(MarketingAutomationsController)
);

router.get(
  '/v2/api/admin/marketing/automations/carts/:id',
  ...admin,
  MarketingAutomationsController.getCart.bind(MarketingAutomationsController)
);

router.delete(
  '/v2/api/admin/marketing/automations/carts/:id',
  ...admin,
  csrf,
  requirePermission('marketing:manage'),
  MarketingAutomationsController.archiveCart.bind(MarketingAutomationsController)
);

router.post(
  '/v2/api/admin/marketing/automations/carts/:id/create-order',
  ...admin,
  csrf,
  requirePermission('marketing:manage'),
  MarketingAutomationsController.createOrderFromCart.bind(MarketingAutomationsController)
);

router.post(
  '/v2/api/admin/marketing/automations/carts/:id/send-email',
  ...admin,
  csrf,
  requirePermission('marketing:manage'),
  MarketingAutomationsController.sendCartRecoveryEmail.bind(MarketingAutomationsController)
);

router.get(
  '/v2/api/admin/marketing/automations/orders',
  ...admin,
  MarketingAutomationsController.listOrders.bind(MarketingAutomationsController)
);

router.get(
  '/v2/api/admin/marketing/automations/orders/:id',
  ...admin,
  MarketingAutomationsController.getOrder.bind(MarketingAutomationsController)
);

router.delete(
  '/v2/api/admin/marketing/automations/orders/:id',
  ...admin,
  csrf,
  requirePermission('marketing:manage'),
  MarketingAutomationsController.archiveOrder.bind(MarketingAutomationsController)
);

router.get(
  '/v2/api/admin/marketing/automations/settings',
  ...admin,
  MarketingAutomationsController.getSettings.bind(MarketingAutomationsController)
);

router.put(
  '/v2/api/admin/marketing/automations/settings',
  ...admin,
  csrf,
  requirePermission('marketing:manage'),
  MarketingAutomationsController.updateSettings.bind(MarketingAutomationsController)
);

router.get(
  '/v2/api/marketing/track/open/:token.gif',
  MarketingAutomationsController.trackOpen.bind(MarketingAutomationsController)
);
router.get(
  '/v2/api/marketing/track/click/:token',
  MarketingAutomationsController.trackClick.bind(MarketingAutomationsController)
);
router.get(
  '/v2/api/cart/recover/:token',
  MarketingAutomationsController.recoverCart.bind(MarketingAutomationsController)
);

router.get(
  '/v2/api/order/reorder/:token',
  MarketingAutomationsController.reorderCancelledOrder.bind(MarketingAutomationsController)
);

module.exports = router;
