const crypto = require('crypto');
const { prisma } = require('../config/prisma');
const { resolveCustomerFromOrder } = require('../utils/checkoutConfig');
const { getEnabledPluginConfig } = require('./pluginConfig.service');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  // BR: garante DDI 55 quando parecer local
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

async function getPaidPaymentMeta(orderId) {
  const paidPayment = await prisma.payment.findFirst({
    where: { orderId, status: 'PAID' },
    orderBy: { createdAt: 'desc' },
  });

  if (!paidPayment) return null;

  const metadata =
    paidPayment.metadata && typeof paidPayment.metadata === 'object'
      ? { ...paidPayment.metadata }
      : {};

  return { payment: paidPayment, metadata };
}

async function setPaymentFlag(paymentId, flagKey) {
  const current = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { metadata: true },
  });
  const metadata =
    current?.metadata && typeof current.metadata === 'object' ? { ...current.metadata } : {};

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      metadata: {
        ...metadata,
        [flagKey]: true,
        [`${flagKey}At`]: new Date().toISOString(),
      },
    },
  });
}

async function loadPurchaseContext(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { name: true, email: true } },
      items: {
        include: {
          product: { select: { name: true } },
          variant: { select: { name: true } },
        },
      },
    },
  });

  if (!order || !['PAID', 'DELIVERED'].includes(order.status)) return null;

  const customer = resolveCustomerFromOrder(order);
  const checkout =
    order.checkoutData && typeof order.checkoutData === 'object' ? order.checkoutData : {};

  const email = normalizeEmail(customer.customerEmail);
  const phone = normalizePhone(customer.customerPhone || checkout.phone || checkout.telefone);

  return {
    order,
    customer,
    email,
    phone,
    value: Number(order.total || 0) / 100,
    contentIds: order.items
      .map((item) => item.variantId || item.productId)
      .filter(Boolean),
    numItems: order.items.reduce((sum, item) => sum + (item.quantity || 0), 0),
    contents: order.items.map((item) => ({
      id: item.variantId || item.productId,
      quantity: item.quantity,
      item_price: Number(item.unitPrice || 0) / 100,
    })),
    eventSourceUrl: `${FRONTEND_URL}/checkout/payment/${order.id}`,
    eventTime: Math.floor(new Date(order.paidAt || order.updatedAt || Date.now()).getTime() / 1000),
  };
}

async function sendFacebookPurchase(ctx) {
  const config = await getEnabledPluginConfig('facebook-pixel');
  const pixelId = config?.pixelId?.trim();
  const accessToken = config?.accessToken?.trim();
  if (!pixelId || !accessToken) return;

  const paid = await getPaidPaymentMeta(ctx.order.id);
  if (!paid || paid.metadata.facebookCapiPurchaseSent) return;

  const userData = {
    client_ip_address: ctx.order.clientIp || undefined,
    client_user_agent: ctx.order.userAgent || undefined,
  };
  if (ctx.email) userData.em = [sha256(ctx.email)];
  if (ctx.phone) userData.ph = [sha256(ctx.phone)];

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: ctx.eventTime,
        event_id: ctx.order.id,
        action_source: 'website',
        event_source_url: ctx.eventSourceUrl,
        user_data: userData,
        custom_data: {
          currency: 'BRL',
          value: ctx.value,
          content_ids: ctx.contentIds,
          content_type: 'product',
          num_items: ctx.numItems,
          contents: ctx.contents.map((c) => ({
            id: c.id,
            quantity: c.quantity,
            item_price: c.item_price,
          })),
        },
      },
    ],
    access_token: accessToken,
  };

  const testEventCode = config?.testEventCode?.trim();
  if (testEventCode) payload.test_event_code = testEventCode;

  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(pixelId)}/events`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[conversionsApi.facebook]', res.status, text.slice(0, 300));
    return;
  }

    await setPaymentFlag(paid.payment.id, 'facebookCapiPurchaseSent');
}

async function sendTikTokPurchase(ctx) {
  const config = await getEnabledPluginConfig('tiktok-pixel');
  const pixelId = config?.pixelId?.trim();
  const accessToken = config?.accessToken?.trim();
  if (!pixelId || !accessToken) return;

  const paid = await getPaidPaymentMeta(ctx.order.id);
  if (!paid || paid.metadata.tiktokCapiPurchaseSent) return;

  const user = {
    ip: ctx.order.clientIp || undefined,
    user_agent: ctx.order.userAgent || undefined,
  };
  if (ctx.email) user.email = sha256(ctx.email);
  if (ctx.phone) user.phone = sha256(ctx.phone);

  const payload = {
    event_source: 'web',
    event_source_id: pixelId,
    data: [
      {
        event: 'CompletePayment',
        event_time: ctx.eventTime,
        event_id: ctx.order.id,
        user,
        page: { url: ctx.eventSourceUrl },
        properties: {
          currency: 'BRL',
          value: ctx.value,
          contents: ctx.contents.map((c) => ({
            content_id: c.id,
            quantity: c.quantity,
            price: c.item_price,
          })),
          content_type: 'product',
        },
      },
    ],
  };

  const testEventCode = config?.testEventCode?.trim();
  if (testEventCode) payload.test_event_code = testEventCode;

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': accessToken,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[conversionsApi.tiktok]', res.status, text.slice(0, 300));
    return;
  }

  await setPaymentFlag(paid.payment.id, 'tiktokCapiPurchaseSent');
}

async function trackServerPurchase(orderId) {
  try {
    const ctx = await loadPurchaseContext(orderId);
    if (!ctx) return;

    await Promise.allSettled([sendFacebookPurchase(ctx), sendTikTokPurchase(ctx)]);
  } catch (err) {
    console.error('[conversionsApi]', err.message);
  }
}

function queueServerPurchase(orderId) {
  setImmediate(() => {
    void trackServerPurchase(orderId);
  });
}

module.exports = {
  trackServerPurchase,
  queueServerPurchase,
};
