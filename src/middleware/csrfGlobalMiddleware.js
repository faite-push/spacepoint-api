const csrf = require('./csrfMiddleware');

const CSRF_SKIP_EXACT = new Set([
  '/api/auth/send-code',
  '/api/auth/verify-code',
  '/v2/api/admin/auth/login',
  '/v2/api/admin/auth/mfa/setup',
  '/v2/api/admin/auth/mfa/verify',
]);

const CSRF_SKIP_PREFIXES = [
  '/v1/webhooks',
  '/login/',
];

function shouldSkipCsrf(req) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;

  const path = (req.path || '').split('?')[0];
  if (CSRF_SKIP_EXACT.has(path)) return true;

  return CSRF_SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** CSRF em todas as mutações, exceto webhooks, OAuth e fluxo pré-autenticação. */
function csrfGlobal(req, res, next) {
  if (shouldSkipCsrf(req)) return next();
  return csrf(req, res, next);
}

module.exports = csrfGlobal;
