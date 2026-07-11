const { prisma } = require('../config/prisma');
const emailService = require('./email.service');
const { abandonedCartRecoveryEmail } = require('../utils/emailTemplates');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

function queueEmail(taskName, fn) {
  setImmediate(async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[abandonedCartEmail.${taskName}]`, err.message);
    }
  });
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function loadSiteBranding() {
  const site = await prisma.siteConfig.findUnique({
    where: { id: 'default' },
    select: { storeName: true },
  });
  return site?.storeName?.trim() || 'Space Point';
}

async function loadCartContext(cartId) {
  const cart = await prisma.abandonedCart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        include: {
          product: { select: { name: true } },
          variant: { select: { name: true } },
        },
      },
      user: { select: { name: true, email: true } },
    },
  });

  if (!cart || cart.convertedAt || cart.recoveryEmailSentAt || !cart.items.length) {
    return null;
  }

  const customerEmail = cart.email || cart.user?.email;
  if (!isValidEmail(customerEmail)) return null;

  const storeName = await loadSiteBranding();
  const items = cart.items.map((item) => ({
    label: item.variant?.name
      ? `${item.product.name} — ${item.variant.name}`
      : item.product.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));

  return {
    cart,
    storeName,
    customerName: cart.customerName || cart.user?.name || 'Cliente',
    customerEmail,
    items,
    subtotal: cart.subtotalCents,
    couponCode: cart.couponCode,
    checkoutUrl: `${FRONTEND_URL}/checkout?recover=1`,
    storeUrl: FRONTEND_URL,
  };
}

function notifyAbandonedCartRecovery(cartId) {
  queueEmail('notifyAbandonedCartRecovery', async () => {
    const ctx = await loadCartContext(cartId);
    if (!ctx) return;

    const template = abandonedCartRecoveryEmail({
      storeName: ctx.storeName,
      customerName: ctx.customerName,
      items: ctx.items,
      subtotal: ctx.subtotal,
      couponCode: ctx.couponCode,
      checkoutUrl: ctx.checkoutUrl,
      storeUrl: ctx.storeUrl,
    });

    const sent = await emailService.sendEmail(
      ctx.customerEmail,
      template.subject,
      template.html
    );

    if (sent) {
      await prisma.abandonedCart.update({
        where: { id: cartId },
        data: { recoveryEmailSentAt: new Date() },
      });
    }
  });
}

module.exports = {
  notifyAbandonedCartRecovery,
};
