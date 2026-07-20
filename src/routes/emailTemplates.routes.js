const { Router } = require('express');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');
const csrf = require('../middleware/csrfMiddleware');
const EmailTemplatesController = require('../controllers/emailTemplates.controllers');

const router = Router();
const view = [authenticate, requireAdmin, requirePermission('marketing:view')];
const manage = [authenticate, requireAdmin, requirePermission('marketing:manage'), csrf];

router.get(
  '/v2/api/admin/marketing/email-templates',
  ...view,
  EmailTemplatesController.get.bind(EmailTemplatesController)
);

router.put(
  '/v2/api/admin/marketing/email-templates',
  ...manage,
  EmailTemplatesController.update.bind(EmailTemplatesController)
);

router.post(
  '/v2/api/admin/marketing/email-templates/preview',
  ...view,
  csrf,
  EmailTemplatesController.preview.bind(EmailTemplatesController)
);

router.post(
  '/v2/api/admin/marketing/email-templates/send-test',
  ...manage,
  EmailTemplatesController.sendTest.bind(EmailTemplatesController)
);

module.exports = router;
