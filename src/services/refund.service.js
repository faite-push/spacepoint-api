const axios = require('axios');
const { prisma } = require('../config/prisma');
const { createEfiInstance } = require('../config/efi.config');
const {
  getPagBankCredentials,
  pagBankAuthHeaders,
} = require('../config/pagbank.config');
const { resolveEfiCertificate } = require('./gatewayValidation.service');
const { reverseOrderInventoryOnRefund } = require('./orderFulfillment.service');
const orderEmailService = require('./orderEmail.service');
const { isGatewaySandbox } = require('../utils/gatewaySandbox');
const {
  recordAdminAction,
  AUDIT_ACTIONS,
  requestContext,
} = require('./auditLog.service');

const MANUAL_PROVIDERS = new Set(['manual-admin', 'dev-mock-pix']);

function formatBrlFromCents(cents) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function buildEfiDevolutionId(seed) {
  const normalized = String(seed || '').replace(/[^a-zA-Z0-9]/g, '');
  const suffix = 'refund';
  const maxBase = 35 - suffix.length;
  return `${normalized.slice(0, maxBase)}${suffix}`;
}

function normalizeSlug(slug) {
  return slug === 'efi-pix' ? 'efi-bank' : slug;
}

const { unlockGatewayConfig } = require('../utils/gatewaySecrets');

function getConfig(gateway) {
  return unlockGatewayConfig(gateway?.config || {});
}

async function getPagBankToken(config) {
  const creds = getPagBankCredentials(config);
  if (creds.hasToken) return creds.token;
  if (!creds.hasOAuth) {
    throw new Error('Informe Client ID + Client Secret ou um Access Token PagBank.');
  }
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const { data } = await axios.post(
    `${creds.baseUrl}/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    }
  );
  return data.access_token;
}

async function resolveStripePaymentIntentId(payment, secretKey) {
  if (!String(payment.externalId || '').startsWith('cs_')) {
    return payment.externalId;
  }

  const { data: session } = await axios.get(
    `https://api.stripe.com/v1/checkout/sessions/${payment.externalId}`,
    {
      auth: { username: secretKey, password: '' },
      params: { 'expand[]': 'payment_intent' },
      timeout: 15000,
    }
  );

  if (typeof session.payment_intent === 'string') return session.payment_intent;
  return session.payment_intent?.id || null;
}

async function refundMercadoPago(payment, gateway) {
  const config = getConfig(gateway);
  const accessToken = config.accessToken || config.access_token;
  const meta = payment.metadata || {};
  let paymentId = payment.externalId;

  if (meta.type === 'CARD') {
    const { data } = await axios.get(
      'https://api.mercadopago.com/v1/payments/search',
      {
        params: { external_reference: payment.orderId, sort: 'date_created', criteria: 'desc' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
      }
    );
    const approved = (data.results || []).find((p) => p.status === 'approved');
    if (!approved?.id) throw new Error('Mercado Pago: pagamento aprovado não encontrado para estorno');
    paymentId = String(approved.id);
  }

  await axios.post(
    `https://api.mercadopago.com/v1/payments/${paymentId}/refunds`,
    {},
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 20000,
    }
  );

  return { provider: 'mercado-pago', externalRefundId: paymentId };
}

async function refundStripe(payment, gateway) {
  const config = getConfig(gateway);
  const secretKey = config.secretKey || config.secret_key;
  const paymentIntentId = await resolveStripePaymentIntentId(payment, secretKey);
  if (!paymentIntentId) throw new Error('Stripe: payment intent não encontrado');

  const params = new URLSearchParams({ payment_intent: paymentIntentId });
  const { data } = await axios.post(
    'https://api.stripe.com/v1/refunds',
    params,
    {
      auth: { username: secretKey, password: '' },
      timeout: 20000,
    }
  );

  return { provider: 'stripe', externalRefundId: data.id };
}

async function refundPagBank(payment, gateway) {
  const config = getConfig(gateway);
  const creds = getPagBankCredentials(config);
  const token = await getPagBankToken(config);

  let data;
  try {
    const response = await axios.get(`${creds.baseUrl}/checkouts/${payment.externalId}`, {
      headers: pagBankAuthHeaders(token),
      timeout: 15000,
    });
    data = response.data;
  } catch {
    const response = await axios.get(`${creds.baseUrl}/orders/${payment.externalId}`, {
      headers: pagBankAuthHeaders(token),
      timeout: 15000,
    });
    data = response.data;
  }

  const charge = data.charges?.find((c) => c.status === 'PAID') || data.charges?.[0];
  const chargeId = charge?.id;
  if (!chargeId) throw new Error('PagBank: cobrança paga não encontrada para estorno');

  await axios.post(
    `${creds.baseUrl}/charges/${chargeId}/cancel`,
    {},
    {
      headers: pagBankAuthHeaders(token),
      timeout: 20000,
    }
  );

  return { provider: 'pagbank', externalRefundId: chargeId };
}

async function refundEfiPix(payment, gateway) {
  const config = getConfig(gateway);
  const efi = createEfiInstance({
    clientId: config.clientId || config.client_id,
    clientSecret: config.clientSecret || config.client_secret,
    sandbox: isGatewaySandbox(config),
    certificateBase64: config.certificateBase64,
    certificatePath: config.certificateBase64 ? undefined : resolveEfiCertificate(config),
  });

  const detail = await efi.pixDetailCharge({ txid: payment.externalId });
  const e2eId = detail?.pix?.[0]?.endToEndId
    || payment.metadata?.e2eId
    || payment.metadata?.endToEndId;

  if (!e2eId) {
    throw new Error('Efí PIX: endToEndId não encontrado. Use "apenas registrar" se o estorno foi manual.');
  }

  const devolutionId = buildEfiDevolutionId(payment.id);
  await efi.pixDevolution(
    { e2eId, id: devolutionId },
    { valor: formatBrlFromCents(payment.amount) }
  );

  return { provider: payment.provider, externalRefundId: devolutionId };
}

async function refundAtGateway(payment) {
  const slug = normalizeSlug(payment.provider);
  if (MANUAL_PROVIDERS.has(slug) || MANUAL_PROVIDERS.has(payment.provider)) {
    return { skipped: true, reason: 'manual_provider' };
  }

  const gateway = await prisma.gatewayConfig.findFirst({
    where: { slug: { in: [slug, payment.provider] }, isActive: true },
  });

  if (!gateway) {
    throw new Error(`Gateway "${payment.provider}" não configurado para estorno automático`);
  }

  if (slug === 'mercado-pago') return refundMercadoPago(payment, gateway);
  if (slug === 'stripe') return refundStripe(payment, gateway);
  if (slug === 'pagbank') return refundPagBank(payment, gateway);
  if (slug === 'efi-bank' || slug === 'efi-pix') return refundEfiPix(payment, gateway);

  throw new Error(`Estorno automático não suportado para o provedor "${payment.provider}"`);
}

function appendRefundNote(existingNotes, reason) {
  const stamp = new Date().toISOString();
  const line = `[REEMBOLSO ${stamp}] ${reason || 'Pedido reembolsado pelo admin'}`;
  return existingNotes?.trim() ? `${existingNotes.trim()}\n${line}` : line;
}

async function processOrderRefund(orderId, { reason = '', skipGateway = false, req = null } = {}) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      payments: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!order) throw new Error('Pedido não encontrado');
  if (order.status === 'REFUNDED') throw new Error('Pedido já foi reembolsado');
  if (!['PAID', 'DELIVERED'].includes(order.status)) {
    throw new Error('Somente pedidos pagos ou entregues podem ser reembolsados');
  }

  const payment = order.payments.find((p) => p.status === 'PAID');
  if (!payment) throw new Error('Nenhum pagamento pago encontrado para este pedido');

  const priorMeta = payment.metadata && typeof payment.metadata === 'object'
    ? { ...payment.metadata }
    : {};

  // Fase 1: claim (marca refundPending no payment)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const current = await tx.order.findUnique({ where: { id: orderId } });
    if (!current || current.status === 'REFUNDED') {
      throw new Error('Pedido já foi reembolsado');
    }
    if (priorMeta.refundPending && priorMeta.gatewayRefund && !skipGateway) {
      return;
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        metadata: {
          ...priorMeta,
          refundPending: true,
          refundClaimedAt: new Date().toISOString(),
          refundReason: reason || null,
        },
      },
    });
  });

  // Fase 2: gateway (fora da transaction)
  let gatewayResult = priorMeta.gatewayRefund || { skipped: true, reason: 'skip_gateway_requested' };
  if (!skipGateway && !priorMeta.gatewayRefund) {
    try {
      gatewayResult = await refundAtGateway(payment);
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          metadata: {
            ...priorMeta,
            refundPending: true,
            refundClaimedAt: priorMeta.refundClaimedAt || new Date().toISOString(),
            refundReason: reason || null,
            gatewayRefund: gatewayResult,
            gatewayRefundAt: new Date().toISOString(),
          },
        },
      });
    } catch (err) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          metadata: {
            ...priorMeta,
            refundPending: false,
            refundFailedAt: new Date().toISOString(),
            refundError: err.message || 'Falha no estorno no gateway',
          },
        },
      });
      throw err;
    }
  }

  // Fase 3: inventário + status REFUNDED
  const updatedOrder = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Order" WHERE id = ${orderId} FOR UPDATE`;

    const current = await tx.order.findUnique({ where: { id: orderId } });
    if (!current || current.status === 'REFUNDED') {
      throw new Error('Pedido já foi reembolsado');
    }

    await reverseOrderInventoryOnRefund(tx, orderId);

    const paymentMeta = payment.metadata && typeof payment.metadata === 'object'
      ? { ...payment.metadata }
      : {};

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'REFUNDED',
        metadata: {
          ...paymentMeta,
          ...priorMeta,
          refundPending: false,
          refundedAt: new Date().toISOString(),
          refundReason: reason || null,
          gatewayRefund: gatewayResult,
        },
      },
    });

    await tx.payment.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    const orderUpdated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'REFUNDED',
        adminNotes: appendRefundNote(current.adminNotes, reason),
      },
    });

    await tx.chat.updateMany({
      where: { orderId },
      data: { status: 'CLOSED', isResolved: true },
    });

    return orderUpdated;
  });

  orderEmailService.notifyOrderRefunded(orderId, {
    reason: reason || 'Pedido reembolsado',
  });

  await recordAdminAction({
    ...requestContext(req),
    action: AUDIT_ACTIONS.ORDER_REFUND,
    targetType: 'order',
    targetId: orderId,
    metadata: {
      paymentId: payment.id,
      amount: payment.amount,
      provider: payment.provider,
      externalId: payment.externalId,
      reason: reason || null,
      skipGateway,
      gatewayRefund: gatewayResult,
      previousStatus: order.status,
      newStatus: 'REFUNDED',
    },
  });

  return {
    success: true,
    order: updatedOrder,
    paymentId: payment.id,
    gatewayRefund: gatewayResult,
  };
}

async function processPaymentRefund(paymentId, options = {}) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new Error('Pagamento não encontrado');
  if (!payment.orderId) throw new Error('Pagamento sem pedido vinculado');
  return processOrderRefund(payment.orderId, options);
}

module.exports = {
  processOrderRefund,
  processPaymentRefund,
  refundAtGateway,
};
