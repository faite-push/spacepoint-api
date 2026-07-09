const crypto = require('crypto');
const { prisma } = require('../config/prisma');

const SIGNATURE_TOLERANCE_SEC = 5 * 60;

function timingSafeEqualHex(a, b) {
  try {
    const left = Buffer.from(String(a), 'hex');
    const right = Buffer.from(String(b), 'hex');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function getGatewayConfig(gateway) {
  return gateway?.config && typeof gateway.config === 'object' ? gateway.config : {};
}

function getWebhookSecret(config) {
  return config.webhookSecret || config.webhook_secret || null;
}

async function findActiveGateway(slugs) {
  const list = Array.isArray(slugs) ? slugs : [slugs];
  return prisma.gatewayConfig.findFirst({
    where: { slug: { in: list }, isActive: true },
  });
}

function verifyMercadoPagoSignature(req, secret) {
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  if (!xSignature) {
    return { valid: false, error: 'Cabeçalho x-signature ausente' };
  }

  const parts = {};
  for (const segment of String(xSignature).split(',')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
  }

  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) {
    return { valid: false, error: 'Formato x-signature inválido' };
  }

  const dataId = req.query?.['data.id']
    || req.query?.id
    || req.body?.data?.id
    || req.body?.id
    || '';

  const manifest = `id:${dataId};request-id:${xRequestId || ''};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  if (!timingSafeEqualHex(v1, expected)) {
    return { valid: false, error: 'Assinatura Mercado Pago inválida' };
  }

  const age = Math.floor(Date.now() / 1000) - parseInt(ts, 10);
  if (Number.isFinite(age) && age > SIGNATURE_TOLERANCE_SEC) {
    return { valid: false, error: 'Assinatura Mercado Pago expirada' };
  }

  return { valid: true };
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) {
    return { valid: false, error: 'Cabeçalho stripe-signature ausente' };
  }

  const parts = {};
  for (const segment of String(signatureHeader).split(',')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
  }

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) {
    return { valid: false, error: 'Formato stripe-signature inválido' };
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  if (!timingSafeEqualHex(signature, expected)) {
    return { valid: false, error: 'Assinatura Stripe inválida' };
  }

  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (Number.isFinite(age) && age > SIGNATURE_TOLERANCE_SEC) {
    return { valid: false, error: 'Assinatura Stripe expirada' };
  }

  return { valid: true };
}

function verifyEfiWebhookPayload(body) {
  if (body?.pix) {
    if (!Array.isArray(body.pix) || body.pix.length === 0) {
      return { valid: false, error: 'Payload PIX Efí inválido' };
    }
    for (const entry of body.pix) {
      if (!entry?.txid || typeof entry.txid !== 'string' || entry.txid.length > 64) {
        return { valid: false, error: 'txid PIX Efí inválido' };
      }
    }
    return { valid: true };
  }

  if (body?.txid) {
    if (typeof body.txid !== 'string' || body.txid.length > 64) {
      return { valid: false, error: 'txid Efí inválido' };
    }
    return { valid: true };
  }

  return { valid: false, error: 'Payload Efí não reconhecido' };
}

function verifyPagBankWebhookPayload(body, query = {}) {
  const payload = { ...query, ...body };
  const orderId = payload?.id
    || payload?.order_id
    || payload?.reference_id
    || payload?.charges?.[0]?.reference_id;

  if (!orderId || String(orderId).length > 128) {
    return { valid: false, error: 'Payload PagBank inválido' };
  }

  return { valid: true };
}

async function assertMercadoPagoWebhook(req) {
  const gateway = await findActiveGateway(['mercado-pago']);
  const secret = getWebhookSecret(getGatewayConfig(gateway));

  if (!secret) {
    console.warn('[webhook] Mercado Pago: webhookSecret não configurado — confiando apenas na verificação via API');
    return { valid: true, skipped: true };
  }

  return verifyMercadoPagoSignature(req, secret);
}

async function assertStripeWebhook(req) {
  const gateway = await findActiveGateway(['stripe']);
  const secret = getWebhookSecret(getGatewayConfig(gateway));

  if (!secret) {
    console.warn('[webhook] Stripe: webhookSecret não configurado — confiando apenas na verificação via API');
    return { valid: true, skipped: true };
  }

  const rawBody = req.rawBody ?? req.body;
  return verifyStripeSignature(rawBody, req.headers['stripe-signature'], secret);
}

function assertEfiWebhook(body) {
  return verifyEfiWebhookPayload(body);
}

function assertPagBankWebhook(body, query = {}) {
  return verifyPagBankWebhookPayload(body, query);
}

module.exports = {
  assertMercadoPagoWebhook,
  assertStripeWebhook,
  assertEfiWebhook,
  assertPagBankWebhook,
};
