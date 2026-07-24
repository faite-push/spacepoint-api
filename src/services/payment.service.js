const { prisma } = require('../config/prisma');
const {
  getGatewayActiveMethods,
  getRequiredFieldsForCheckout,
} = require('../config/gatewayCapabilities');
const {
  createPixCharge,
  createCardCharge,
  verifyAndFulfillPayment,
  syncPendingOrderPayment,
  handleEfiWebhook,
  handleMercadoPagoWebhook,
  handlePagBankWebhook,
  handleStripeWebhook,
} = require('./gatewayProviders.service');
const orderEmailService = require('./orderEmail.service');

const PIX_EXPIRATION_SECONDS = 30 * 60;
const SUPPORTED_CHECKOUT_METHODS = ['PIX', 'CARD'];

function normalizeCheckoutMethod(method) {
  const normalized = String(method || 'PIX').trim().toUpperCase();
  return SUPPORTED_CHECKOUT_METHODS.includes(normalized) ? normalized : 'PIX';
}

function isEfiConfigured(dbConfig) {
  if (dbConfig?.config) {
    const c = dbConfig.config;
    return Boolean(
      (c.clientId || c.client_id)
      && (c.clientSecret || c.client_secret)
      && (c.pixKey || c.pix_key)
      && (c.certificateBase64 || c.certificatePath || process.env.EFI_CERT_PATH)
    );
  }
  return Boolean(
    process.env.EFI_CLIENT_ID
    && process.env.EFI_CLIENT_SECRET
    && process.env.EFI_PIX_KEY
  );
}

function formatBrlFromCents(cents) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function parsePaymentMetadata(payment) {
  if (!payment?.metadata || typeof payment.metadata !== 'object') return null;
  return payment.metadata;
}

function inferPaymentType(payment) {
  const meta = parsePaymentMetadata(payment);
  if (meta?.type) return meta.type;
  if (payment.provider === 'stripe' && String(payment.externalId || '').startsWith('cs_')) {
    return 'CARD';
  }
  return 'PIX';
}

async function resolveActivePixGateway() {
  const gateways = await prisma.gatewayConfig.findMany({ orderBy: { name: 'asc' } });
  return gateways.find((gw) => getGatewayActiveMethods(gw).PIX) || null;
}

async function resolveActiveCardGateway() {
  const gateways = await prisma.gatewayConfig.findMany({ orderBy: { name: 'asc' } });
  return gateways.find((gw) => getGatewayActiveMethods(gw).CARD) || null;
}

async function findPendingPayment(orderId, paymentMethod) {
  const expectedType = normalizeCheckoutMethod(paymentMethod);
  const payment = await prisma.payment.findFirst({
    where: {
      orderId,
      status: 'PENDING',
      provider: { in: ['efi-bank', 'efi-pix', 'mercado-pago', 'pagbank', 'stripe', 'dev-mock-pix'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) return null;
  if (inferPaymentType(payment) !== expectedType) return null;
  return payment;
}

async function createDevMockPix(order) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Nenhum gateway PIX ativo. Ative um gateway na dashboard.');
  }

  const expiresAt = new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString();
  const amountLabel = formatBrlFromCents(order.total);

  const metadata = {
    type: 'PIX',
    copyPaste: `00020101021226850014br.gov.bcb.pix2563pix-qr-codes.efi.com.br/v2/cobv/${order.id.slice(0, 8)}5204000053039865404${amountLabel}5802BR5908SPACEPN6009SAO PAULO62070503***6304ABCD`,
    qrCode: null,
    expiresAt,
    devMock: true,
    message: 'Modo desenvolvimento: configure um gateway de pagamento na dashboard.',
  };

  await prisma.payment.create({
    data: {
      userId: order.userId,
      orderId: order.id,
      amount: order.total,
      status: 'PENDING',
      provider: 'dev-mock-pix',
      externalId: `mock-${order.id}-${Date.now()}`,
      description: `PIX mock pedido ${order.id}`,
      metadata,
    },
  });

  orderEmailService.notifyPaymentPending(order.id, metadata);

  return metadata;
}

async function getCheckoutPaymentOptions(paymentMethod = 'PIX') {
  const pixGateway = await resolveActivePixGateway();
  const cardGateway = await resolveActiveCardGateway();
  const methods = [];
  if (pixGateway) methods.push('PIX');
  if (cardGateway) methods.push('CARD');

  const pixSlug = pixGateway?.slug || null;
  const cardSlug = cardGateway?.slug || null;
  const requiredCustomerFields = getRequiredFieldsForCheckout(pixSlug, cardSlug, paymentMethod);

  return {
    pixGateway: pixSlug,
    cardGateway: cardSlug,
    gateway: pixSlug || cardSlug || null,
    methods: methods.length ? methods : ['PIX'],
    requiredCustomerFields,
    requiredFieldsByMethod: {
      PIX: getRequiredFieldsForCheckout(pixSlug, cardSlug, 'PIX'),
      CARD: getRequiredFieldsForCheckout(pixSlug, cardSlug, 'CARD'),
    },
  };
}

async function getOrCreateCheckoutPayment(order, paymentMethod = 'PIX') {
  const selectedMethod = normalizeCheckoutMethod(paymentMethod);
  const lockedMethod = order.paymentMethod
    ? normalizeCheckoutMethod(order.paymentMethod)
    : selectedMethod;
  if (order.status !== 'PENDING') return null;
  if (order.total <= 0) {
    throw new Error('Valor do pedido inválido para pagamento');
  }

  // Lock no pedido evita duas cobranças concorrentes (refresh/poll)
  const gate = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Order" WHERE id = ${order.id} FOR UPDATE`;

    const current = await tx.order.findUnique({
      where: { id: order.id },
      select: { id: true, status: true, total: true, paymentMethod: true },
    });
    if (!current || current.status !== 'PENDING') return { action: 'noop' };

    const existing = await tx.payment.findFirst({
      where: {
        orderId: order.id,
        status: 'PENDING',
        metadata: { path: ['type'], equals: lockedMethod },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const meta = parsePaymentMetadata(existing);
      const notExpired = !meta?.expiresAt || new Date(meta.expiresAt) > new Date();
      if (lockedMethod === 'CARD' && meta?.checkoutUrl && notExpired) {
        return { action: 'reuse', payment: existing, meta };
      }
      if (lockedMethod === 'PIX' && meta?.copyPaste && notExpired) {
        return { action: 'reuse', payment: existing, meta };
      }
      await tx.payment.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED' },
      });
    }

    return { action: 'create', orderId: order.id, method: lockedMethod };
  });

  if (!gate || gate.action === 'noop') return null;

  if (gate.action === 'reuse') {
    if (gate.payment.provider !== 'dev-mock-pix') {
      const fulfilled = await verifyAndFulfillPayment(gate.payment);
      if (fulfilled) return null;
    }
    return gate.meta;
  }

  if (gate.method === 'CARD') {
    const gateway = await resolveActiveCardGateway();
    if (!gateway) {
      throw new Error('Nenhum gateway de cartão está ativo. Ative Cartão em um gateway na dashboard.');
    }
    return createCardCharge(order, gateway);
  }

  const pixGateway = await resolveActivePixGateway();
  if (pixGateway) {
    return createPixCharge(order, pixGateway);
  }

  return createDevMockPix(order);
}

async function verifyAndFulfillPixByTxid(txid) {
  if (!txid) return false;
  const payment = await prisma.payment.findFirst({
    where: {
      externalId: txid,
      status: 'PENDING',
      provider: { in: ['efi-bank', 'efi-pix'] },
    },
  });
  if (!payment) return false;
  return verifyAndFulfillPayment(payment);
}

module.exports = {
  isEfiConfigured,
  getCheckoutPaymentOptions,
  getOrCreateCheckoutPayment,
  syncPendingOrderPayment,
  verifyAndFulfillPixByTxid,
  verifyAndFulfillPayment,
  handleEfiWebhook,
  handleMercadoPagoWebhook,
  handlePagBankWebhook,
  handleStripeWebhook,
};
