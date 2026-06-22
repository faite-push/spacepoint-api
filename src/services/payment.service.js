const { prisma } = require('../config/prisma');
const { PIX_GATEWAY_SLUGS } = require('./gatewayValidation.service');
const {
  createPixCharge,
  verifyAndFulfillPayment,
  syncPendingOrderPayment,
  handleEfiWebhook,
  handleMercadoPagoWebhook,
  handlePagBankWebhook,
  handleStripeWebhook,
} = require('./gatewayProviders.service');

const PIX_EXPIRATION_SECONDS = 30 * 60;

async function getActiveGatewayConfig(slug) {
  return prisma.gatewayConfig.findFirst({
    where: { slug, isActive: true },
  });
}

async function resolveActivePixGateway() {
  const slugs = [...PIX_GATEWAY_SLUGS, 'efi-pix'];
  for (const slug of slugs) {
    const gw = await getActiveGatewayConfig(slug);
    if (gw) return gw;
  }
  return null;
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

async function findPendingPixPayment(orderId) {
  return prisma.payment.findFirst({
    where: {
      orderId,
      status: 'PENDING',
      provider: { in: ['efi-bank', 'efi-pix', 'mercado-pago', 'pagbank', 'stripe', 'dev-mock-pix'] },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function createDevMockPix(order) {
  if (process.env.NODE_ENV === 'production' && !(await resolveActivePixGateway())) {
    throw new Error('Gateway de pagamento não configurado');
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

  return metadata;
}

async function getOrCreatePixPayment(order) {
  if (order.status !== 'PENDING') return null;
  if (order.total <= 0) {
    throw new Error('Valor do pedido inválido para pagamento');
  }

  const existing = await findPendingPixPayment(order.id);
  if (existing) {
    if (existing.provider !== 'dev-mock-pix') {
      const fulfilled = await verifyAndFulfillPayment(existing);
      if (fulfilled) return null;
    }

    const meta = parsePaymentMetadata(existing);
    if (meta?.copyPaste && meta?.expiresAt) {
      if (new Date(meta.expiresAt) > new Date()) {
        return meta;
      }
    }
    await prisma.payment.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED' },
    });
  }

  const gateway = await resolveActivePixGateway();
  if (gateway) {
    return createPixCharge(order, gateway);
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
  getOrCreatePixPayment,
  syncPendingOrderPayment,
  verifyAndFulfillPixByTxid,
  verifyAndFulfillPayment,
  handleEfiWebhook,
  handleMercadoPagoWebhook,
  handlePagBankWebhook,
  handleStripeWebhook,
};
