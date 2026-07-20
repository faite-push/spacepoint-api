const { prisma } = require('../config/prisma');
const emailService = require('./email.service');
const { abandonedCartRecoveryEmail, withEmailLayout } = require('../utils/emailTemplates');
const { ensureCartToken, formatRecoveryUrl } = require('./marketingAutomations.service');
const { getEmailTemplates } = require('../utils/emailTemplatesSettings');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || process.env.BACKEND_URL || '').replace(/\/$/, '');

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
  };
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

  const token = await ensureCartToken(cartId);
  const branding = await loadSiteBranding();
  const items = cart.items.map((item) => ({
    label: item.variant?.name
      ? `${item.product.name} — ${item.variant.name}`
      : item.product.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));

  const trackBase = API_PUBLIC_URL || FRONTEND_URL;
  const checkoutUrl = `${trackBase}/v2/api/marketing/track/click/${token}`;
  const openPixelUrl = `${trackBase}/v2/api/marketing/track/open/${token}.gif`;

  return withEmailLayout({
    cart,
    storeName: branding.storeName,
    logoUrl: branding.logoUrl,
    logoWhiteUrl: branding.logoWhiteUrl,
    contactEmail: branding.contactEmail,
    customBodies: branding.customBodies,
    customerName: cart.customerName || cart.user?.name || 'Cliente',
    customerEmail,
    items,
    subtotal: cart.subtotalCents,
    couponCode: cart.couponCode,
    checkoutUrl,
    openPixelUrl,
    storeUrl: branding.storeUrl || FRONTEND_URL,
    recoveryUrl: formatRecoveryUrl(token),
  }, {
    headerHtml: branding.headerHtml,
    footerHtml: branding.footerHtml,
    bodies: branding.customBodies,
  });
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
      openPixelUrl: ctx.openPixelUrl,
      storeUrl: ctx.storeUrl,
      headerHtml: ctx.headerHtml,
      footerHtml: ctx.footerHtml,
      logoUrl: ctx.logoUrl,
      logoWhiteUrl: ctx.logoWhiteUrl,
      contactEmail: ctx.contactEmail,
      customBodies: ctx.customBodies,
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
