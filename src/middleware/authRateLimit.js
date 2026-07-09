const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function emailOrIpKey(req) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (email) return email;
  return ipKeyGenerator(req);
}

function emailAndIpKey(req) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  return `${email || 'anon'}:${ipKeyGenerator(req)}`;
}

/** Envio de código OTP — máx. 5 por e-mail a cada 15 min */
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailOrIpKey,
  message: { error: 'Muitas tentativas de envio. Tente novamente em 15 minutos.' },
});

/** Verificação OTP — máx. 20 por e-mail+IP a cada 15 min (anti brute-force) */
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailAndIpKey,
  message: { error: 'Muitas tentativas de verificação. Tente novamente em 15 minutos.' },
});

/** Login admin — máx. 10 por e-mail a cada 15 min */
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailOrIpKey,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

/** MFA admin — máx. 15 por IP a cada 15 min */
const adminMfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  message: { error: 'Muitas tentativas de verificação MFA. Tente novamente em 15 minutos.' },
});

/** Webhooks — proteção contra flood */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  message: { error: 'Limite de webhooks atingido.' },
});

module.exports = {
  otpSendLimiter,
  otpVerifyLimiter,
  adminLoginLimiter,
  adminMfaLimiter,
  webhookLimiter,
};
