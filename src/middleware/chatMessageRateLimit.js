const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function chatMessageRateKey(req) {
  if (req.user?.id) return req.user.id;
  return ipKeyGenerator(req);
}

/** Burst: no máximo 3 mensagens a cada 5 segundos (clientes) */
const clientChatBurstLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: chatMessageRateKey,
  skip: (req) => Boolean(req.user?.isAdmin),
  message: { error: 'Aguarde alguns segundos antes de enviar outra mensagem.' },
});

/** Sustentado: no máximo 15 mensagens por minuto (clientes) */
const clientChatMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: chatMessageRateKey,
  skip: (req) => Boolean(req.user?.isAdmin),
  message: { error: 'Você está enviando mensagens muito rápido. Aguarde um momento antes de enviar novamente.' },
});

module.exports = { clientChatBurstLimiter, clientChatMessageLimiter };
