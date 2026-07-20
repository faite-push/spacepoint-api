const { prisma } = require('../config/prisma');
const { resolveCustomerFromOrder } = require('../utils/checkoutConfig');
const emailService = require('./email.service');
const {
  orderCreatedEmail,
  paymentPendingEmail,
  paymentConfirmedEmail,
  orderDeliveredEmail,
  reviewInviteEmail,
  orderCancelledEmail,
  withEmailLayout,
} = require('../utils/emailTemplates');
const { getEmailTemplates } = require('../utils/emailTemplatesSettings');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

function queueEmail(taskName, fn) {
  setImmediate(async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[orderEmail.${taskName}]`, err.message);
    }
  });
}

function buildPaymentUrl(orderId) {
  return `${FRONTEND_URL}/checkout/payment/${orderId}`;
}

function buildOrderUrl(orderId) {
  return `${FRONTEND_URL}/account/orders/${orderId}`;
}

function buildReviewUrl(orderId) {
  return `${FRONTEND_URL}/account/orders/${orderId}?review=1`;
}

function buildStoreUrl() {
  return FRONTEND_URL;
}

async function loadSiteBranding() {
  const { templates, branding } = await getEmailTemplates(prisma);
  return {
    storeName: branding.storeName,
    logoUrl: branding.logoUrl,
    logoWhiteUrl: branding.logoWhiteUrl,
    storeUrl: branding.storeUrl,
    contactEmail: branding.contactEmail,
    headerHtml: templates.headerHtml,
    footerHtml: templates.footerHtml,
    customBodies: templates.bodies,
    customSubjects: templates.subjects,
    customPreheaders: templates.preheaders,
  };
}

async function loadOrderContext(orderId) {
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

  if (!order) return null;

  const customer = resolveCustomerFromOrder(order);
  const branding = await loadSiteBranding();

  const items = order.items.map((item) => ({
    label: item.variant?.name
      ? `${item.product.name} — ${item.variant.name}`
      : item.variantName
        ? `${item.product.name} — ${item.variantName}`
        : item.product.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));

  return withEmailLayout({
    order,
    storeName: branding.storeName,
    logoUrl: branding.logoUrl,
    logoWhiteUrl: branding.logoWhiteUrl,
    contactEmail: branding.contactEmail,
    customBodies: branding.customBodies,
    customSubjects: branding.customSubjects,
    customPreheaders: branding.customPreheaders,
    customerName: customer.customerName,
    customerEmail: customer.customerEmail,
    items,
    total: order.total,
    discount: order.discount,
    deliveryFee: order.deliveryFee,
    paymentExpiresAt: order.paymentExpiresAt,
    paymentMethod: String(order.paymentMethod || 'PIX').toUpperCase(),
    orderId: order.id,
    paymentUrl: buildPaymentUrl(order.id),
    orderUrl: buildOrderUrl(order.id),
    reviewUrl: buildReviewUrl(order.id),
    storeUrl: branding.storeUrl || buildStoreUrl(),
  }, {
    headerHtml: branding.headerHtml,
    footerHtml: branding.footerHtml,
    bodies: branding.customBodies,
    subjects: branding.customSubjects,
    preheaders: branding.customPreheaders,
  });
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function layoutFields(ctx) {
  return {
    headerHtml: ctx.headerHtml,
    footerHtml: ctx.footerHtml,
    logoUrl: ctx.logoUrl,
    logoWhiteUrl: ctx.logoWhiteUrl,
    storeUrl: ctx.storeUrl,
    contactEmail: ctx.contactEmail,
    customBodies: ctx.customBodies,
    customSubjects: ctx.customSubjects,
    customPreheaders: ctx.customPreheaders,
  };
}

async function sendToCustomer(email, subject, html) {
  if (!isValidEmail(email)) {
    console.warn('[orderEmail] E-mail inválido, envio ignorado:', email);
    return false;
  }
  return emailService.sendEmail(email, subject, html);
}

function notifyOrderCreated(orderId) {
  queueEmail('notifyOrderCreated', async () => {
    const ctx = await loadOrderContext(orderId);
    if (!ctx || ctx.order.status !== 'PENDING') return;

    const template = orderCreatedEmail({
      storeName: ctx.storeName,
      customerName: ctx.customerName,
      orderId: ctx.orderId,
      items: ctx.items,
      total: ctx.total,
      discount: ctx.discount,
      deliveryFee: ctx.deliveryFee,
      paymentExpiresAt: ctx.paymentExpiresAt,
      paymentUrl: ctx.paymentUrl,
      ...layoutFields(ctx),
    });

    await sendToCustomer(ctx.customerEmail, template.subject, template.html);
  });
}

function notifyPaymentPending(orderId, paymentMeta = {}) {
  queueEmail('notifyPaymentPending', async () => {
    const ctx = await loadOrderContext(orderId);
    if (!ctx || ctx.order.status !== 'PENDING') return;

    const payment = await prisma.payment.findFirst({
      where: { orderId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) return;

    const metadata = payment.metadata && typeof payment.metadata === 'object'
      ? { ...payment.metadata }
      : {};

    if (metadata.emailPaymentPendingSent) return;

    const type = String(paymentMeta.type || metadata.type || ctx.paymentMethod).toUpperCase();
    const template = paymentPendingEmail({
      storeName: ctx.storeName,
      customerName: ctx.customerName,
      orderId: ctx.orderId,
      items: ctx.items,
      total: ctx.total,
      discount: ctx.discount,
      deliveryFee: ctx.deliveryFee,
      paymentMethod: type === 'CARD' ? 'CARD' : 'PIX',
      copyPaste: paymentMeta.copyPaste || metadata.copyPaste || null,
      expiresAt: paymentMeta.expiresAt || metadata.expiresAt || ctx.paymentExpiresAt,
      paymentUrl: ctx.paymentUrl,
      ...layoutFields(ctx),
    });

    const sent = await sendToCustomer(ctx.customerEmail, template.subject, template.html);
    if (!sent) return;

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        metadata: {
          ...metadata,
          emailPaymentPendingSent: true,
          emailPaymentPendingSentAt: new Date().toISOString(),
        },
      },
    });
  });
}

function notifyPaymentConfirmed(orderId) {
  queueEmail('notifyPaymentConfirmed', async () => {
    const ctx = await loadOrderContext(orderId);
    if (!ctx) return;
    if (!['PAID', 'DELIVERED'].includes(ctx.order.status)) return;

    const paidPayment = await prisma.payment.findFirst({
      where: { orderId, status: 'PAID' },
      orderBy: { createdAt: 'desc' },
    });

    const metadata = paidPayment?.metadata && typeof paidPayment.metadata === 'object'
      ? { ...paidPayment.metadata }
      : {};

    if (metadata.emailPaymentConfirmedSent) return;

    const template = paymentConfirmedEmail({
      storeName: ctx.storeName,
      customerName: ctx.customerName,
      orderId: ctx.orderId,
      items: ctx.items,
      total: ctx.total,
      discount: ctx.discount,
      deliveryFee: ctx.deliveryFee,
      orderUrl: ctx.orderUrl,
      ...layoutFields(ctx),
    });

    const sent = await sendToCustomer(ctx.customerEmail, template.subject, template.html);
    if (!sent) return;

    if (paidPayment) {
      await prisma.payment.update({
        where: { id: paidPayment.id },
        data: {
          metadata: {
            ...metadata,
            emailPaymentConfirmedSent: true,
            emailPaymentConfirmedSentAt: new Date().toISOString(),
          },
        },
      });
    }
  });
}

function notifyOrderDelivered(orderId) {
  queueEmail('notifyOrderDelivered', async () => {
    const ctx = await loadOrderContext(orderId);
    if (!ctx || ctx.order.status !== 'DELIVERED') return;

    const chat = await prisma.chat.findUnique({
      where: { orderId },
      select: { reviewInviteSentAt: true, rating: true },
    });

    if (chat?.reviewInviteSentAt) return;

    const template = orderDeliveredEmail({
      storeName: ctx.storeName,
      customerName: ctx.customerName,
      orderId: ctx.orderId,
      items: ctx.items,
      total: ctx.total,
      discount: ctx.discount,
      deliveryFee: ctx.deliveryFee,
      orderUrl: ctx.orderUrl,
      reviewUrl: buildReviewUrl(ctx.orderId),
      includeReviewCta: !chat?.rating,
      ...layoutFields(ctx),
    });

    const sent = await sendToCustomer(ctx.customerEmail, template.subject, template.html);
    if (!sent || !chat) return;

    await prisma.chat.update({
      where: { orderId },
      data: { reviewInviteSentAt: new Date() },
    });
  });
}

function notifyReviewInvite(orderId) {
  queueEmail('notifyReviewInvite', async () => {
    const ctx = await loadOrderContext(orderId);
    if (!ctx || ctx.order.status !== 'DELIVERED') return;

    const chat = await prisma.chat.findUnique({
      where: { orderId },
      select: { rating: true, reviewInviteSentAt: true },
    });

    if (!chat || chat.rating) return;

    const template = reviewInviteEmail({
      storeName: ctx.storeName,
      customerName: ctx.customerName,
      orderId: ctx.orderId,
      reviewUrl: buildReviewUrl(ctx.orderId),
      ...layoutFields(ctx),
    });

    const sent = await sendToCustomer(ctx.customerEmail, template.subject, template.html);
    if (!sent) return;

    await prisma.chat.update({
      where: { orderId },
      data: { reviewInviteSentAt: new Date() },
    });
  });
}

function notifyReviewReminder(orderId) {
  queueEmail('notifyReviewReminder', async () => {
    const ctx = await loadOrderContext(orderId);
    if (!ctx || ctx.order.status !== 'DELIVERED') return;

    const chat = await prisma.chat.findUnique({
      where: { orderId },
      select: { rating: true, reviewReminderSentAt: true },
    });

    if (!chat || chat.rating || chat.reviewReminderSentAt) return;

    const template = reviewInviteEmail({
      storeName: ctx.storeName,
      customerName: ctx.customerName,
      orderId: ctx.orderId,
      reviewUrl: buildReviewUrl(ctx.orderId),
      ...layoutFields(ctx),
    });

    const sent = await sendToCustomer(ctx.customerEmail, template.subject, template.html);
    if (!sent) return;

    await prisma.chat.update({
      where: { orderId },
      data: { reviewReminderSentAt: new Date() },
    });
  });
}

function notifyOrderCancelled(orderId, { reason = 'Pedido cancelado', expired = false } = {}) {
  queueEmail('notifyOrderCancelled', async () => {
    const ctx = await loadOrderContext(orderId);
    if (!ctx || ctx.order.status !== 'CANCELLED') return;

    const template = orderCancelledEmail({
      storeName: ctx.storeName,
      customerName: ctx.customerName,
      orderId: ctx.orderId,
      reason,
      expired,
      storeUrl: ctx.storeUrl,
      ...layoutFields(ctx),
    });

    await sendToCustomer(ctx.customerEmail, template.subject, template.html);
  });
}

module.exports = {
  notifyOrderCreated,
  notifyPaymentPending,
  notifyPaymentConfirmed,
  notifyOrderDelivered,
  notifyReviewInvite,
  notifyReviewReminder,
  notifyOrderCancelled,
};
