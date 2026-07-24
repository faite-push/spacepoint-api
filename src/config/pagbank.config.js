const SANDBOX_BASE_URL = 'https://sandbox.api.pagseguro.com';
const PRODUCTION_BASE_URL = 'https://api.pagseguro.com';
const { isGatewaySandbox } = require('../utils/gatewaySandbox');

function normalizePagBankToken(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let token = raw.trim();
  if (/^bearer\s+/i.test(token)) {
    token = token.slice(7).trim();
  }
  return token;
}

function getPagBankCredentials(config = {}) {
  const token = normalizePagBankToken(config.token || config.accessToken);
  const clientId = String(config.clientId || config.client_id || '').trim();
  const clientSecret = String(config.clientSecret || config.client_secret || '').trim();
  const hasOAuth = Boolean(clientId && clientSecret);
  const hasToken = Boolean(token);
  const sandbox = isGatewaySandbox(config);

  return {
    token,
    clientId,
    clientSecret,
    hasOAuth,
    hasToken,
    sandbox,
    baseUrl: sandbox ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL,
  };
}

function pagBankAuthHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

function isPagBankAuthError(err) {
  const code = err?.response?.data?.error_messages?.[0]?.error;
  return code === 'invalid_authorization_header' || err?.response?.status === 401;
}

module.exports = {
  SANDBOX_BASE_URL,
  PRODUCTION_BASE_URL,
  normalizePagBankToken,
  getPagBankCredentials,
  pagBankAuthHeaders,
  isPagBankAuthError,
};
