const { prisma } = require('../config/prisma');
const emailService = require('./email.service');
const { abandonedCartRecoveryEmail, withEmailLayout } = require('../utils/emailTemplates');
const { ensureCartToken, formatRecoveryUrl } = require('./marketingAutomations.service');
const { getEmailTemplates } = require('../utils/emailTemplatesSettings');
const { parseSentMap, mergeSentMap, removeSentDelay } = require('../utils/recoverySequence');
const { getAbandonedCartSettings } = require('../utils/abandonedCartSettings');
const { resolveMediaUrl } = require('../utils/mediaUrl');

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
    customSubjects: templates.subjects,
    customPreheaders: templates.preheaders,
  };
}

async function claimCartEmailDelay(cartId, delayHours) {
  const hours = Number(delayHours) || 1;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, "recoveryEmailsSent", "recoveryEmailSentAt", "convertedAt"
      FROM "AbandonedCart"
      WHERE id = ${cartId}
      FOR UPDATE
    `;
    const cart = rows[0];
    if (!cart || cart.convertedAt) return false;
    const sentMap = parseSentMap(cart.recoveryEmailsSent, cart.recoveryEmailSentAt, hours);
    if (sentMap[hours]) return false;
    const nextMap = mergeSentMap(sentMap, hours);
    await tx.abandonedCart.update({
      where: { id: cartId },
      data: {
        recoveryEmailSentAt: cart.recoveryEmailSentAt || new Date(),
        recoveryEmailsSent: nextMap,
      },
    });
    return true;
  });
}

async function releaseCartEmailDelay(cartId, delayHours) {
  const hours = Number(delayHours) || 1;
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT id, "recoveryEmailsSent", "recoveryEmailSentAt"
        FROM "AbandonedCart"
        WHERE id = ${cartId}
        FOR UPDATE
      `;
      const cart = rows[0];
      if (!cart) return;
      const sentMap = parseSentMap(cart.recoveryEmailsSent, cart.recoveryEmailSentAt, hours);
      const nextMap = removeSentDelay(sentMap, hours);
      await tx.abandonedCart.update({
        where: { id: cartId },
        data: {
          recoveryEmailsSent: Object.keys(nextMap).length ? nextMap : null,
          recoveryEmailSentAt:
            Object.keys(nextMap).length > 0 ? cart.recoveryEmailSentAt || new Date() : null,
        },
      });
    });
  } catch (err) {
    console.error('[abandonedCartEmail.releaseCartEmailDelay]', err.message);
  }
}

async function loadCartContext(cartId, { delayHours, stepIndex, skipSentCheck = false } = {}) {
  const cart = await prisma.abandonedCart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        include: {
          product: { select: { name: true, imageUrl: true } },
          variant: { select: { name: true, imageUrl: true } },
        },
      },
      user: { select: { name: true, email: true } },
    },
  });

  if (!cart || cart.convertedAt || !cart.items.length) {
    return null;
  }

  if (delayHours && !skipSentCheck) {
    const sentMap = parseSentMap(cart.recoveryEmailsSent, cart.recoveryEmailSentAt, delayHours);
    if (sentMap[delayHours]) return null;
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
    imageUrl: resolveMediaUrl(item.variant?.imageUrl || item.product?.imageUrl || null),
  }));

  const trackBase = API_PUBLIC_URL || FRONTEND_URL;
  const checkoutUrl = `${trackBase}/v2/api/marketing/track/click/${token}`;
  const openPixelUrl = `${trackBase}/v2/api/marketing/track/open/${token}.gif`;

  return withEmailLayout(
    {
      cart,
      storeName: branding.storeName,
      logoUrl: branding.logoUrl,
      logoWhiteUrl: branding.logoWhiteUrl,
      contactEmail: branding.contactEmail,
      customBodies: branding.customBodies,
      customSubjects: branding.customSubjects,
      customPreheaders: branding.customPreheaders,
      customerName: cart.customerName || cart.user?.name || 'Cliente',
      customerEmail,
      items,
      subtotal: cart.subtotalCents,
      couponCode: cart.couponCode,
      checkoutUrl,
      openPixelUrl,
      storeUrl: branding.storeUrl || FRONTEND_URL,
      recoveryUrl: formatRecoveryUrl(token),
      stepIndex: stepIndex || 1,
      delayHours: delayHours || null,
    },
    {
      headerHtml: branding.headerHtml,
      footerHtml: branding.footerHtml,
      bodies: branding.customBodies,
      subjects: branding.customSubjects,
      preheaders: branding.customPreheaders,
    }
  );
}

/**
 * Envia (ou tenta enviar) um e-mail de recuperação de carrinho.
 * Faz claim atômico do delay antes do envio para evitar duplicatas.
 */
async function sendAbandonedCartRecovery(cartId, step = {}) {
  const delayHours = step.delayHours || 1;
  const stepIndex = step.stepIndex || 1;

  const ctx = await loadCartContext(cartId, { delayHours, stepIndex });
  if (!ctx) {
    return { sent: false, reason: 'Carrinho indisponível, sem e-mail ou etapa já enviada' };
  }

  const claimed = await claimCartEmailDelay(cartId, delayHours);
  if (!claimed) {
    return { sent: false, reason: 'Etapa já reivindicada por outro envio' };
  }

  try {
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
      customSubjects: ctx.customSubjects,
      customPreheaders: ctx.customPreheaders,
      stepIndex,
    });

    const sent = await emailService.sendEmail(
      ctx.customerEmail,
      template.subject,
      template.html
    );

    if (!sent) {
      await releaseCartEmailDelay(cartId, delayHours);
      return { sent: false, reason: 'Falha no provedor de e-mail' };
    }

    return {
      sent: true,
      email: ctx.customerEmail,
      delayHours,
      stepIndex,
    };
  } catch (err) {
    await releaseCartEmailDelay(cartId, delayHours);
    throw err;
  }
}

function notifyAbandonedCartRecovery(cartId, step = {}) {
  queueEmail('notifyAbandonedCartRecovery', async () => {
    await sendAbandonedCartRecovery(cartId, step);
  });
}

/** Próxima etapa não enviada da régua (ignora horário — uso manual/admin). */
async function resolveNextManualCartStep(cartId) {
  const settings = await getAbandonedCartSettings(prisma);
  const delays =
    Array.isArray(settings.cartEmailDelays) && settings.cartEmailDelays.length
      ? settings.cartEmailDelays
      : [settings.delayHours || 1];

  const cart = await prisma.abandonedCart.findUnique({
    where: { id: cartId },
    select: {
      id: true,
      convertedAt: true,
      email: true,
      recoveryEmailsSent: true,
      recoveryEmailSentAt: true,
      user: { select: { email: true } },
      items: { select: { id: true }, take: 1 },
    },
  });

  if (!cart || cart.convertedAt) {
    const err = new Error('Carrinho não encontrado ou já convertido');
    err.status = 404;
    throw err;
  }
  if (!cart.items.length) {
    const err = new Error('Carrinho sem itens');
    err.status = 400;
    throw err;
  }

  const customerEmail = cart.email || cart.user?.email;
  if (!isValidEmail(customerEmail)) {
    const err = new Error('Carrinho sem e-mail válido');
    err.status = 400;
    throw err;
  }

  const sorted = [...delays]
    .map((h) => Number(h))
    .filter((h) => Number.isFinite(h) && h > 0)
    .sort((a, b) => a - b);

  const minDelay = sorted[0] || 1;
  const sentMap = parseSentMap(cart.recoveryEmailsSent, cart.recoveryEmailSentAt, minDelay);

  for (let i = 0; i < sorted.length; i++) {
    const hours = sorted[i];
    if (sentMap[hours]) continue;
    return {
      delayHours: hours,
      stepIndex: i + 1,
      stepTotal: sorted.length,
    };
  }

  const err = new Error('Todos os e-mails da régua já foram enviados para este carrinho');
  err.status = 409;
  throw err;
}

async function sendManualAbandonedCartRecovery(cartId) {
  const step = await resolveNextManualCartStep(cartId);
  const result = await sendAbandonedCartRecovery(cartId, step);
  if (!result.sent) {
    const err = new Error(result.reason || 'Não foi possível enviar o e-mail');
    err.status = 400;
    throw err;
  }
  return {
    success: true,
    email: result.email,
    delayHours: result.delayHours,
    stepIndex: result.stepIndex,
    stepTotal: step.stepTotal,
  };
}

module.exports = {
  notifyAbandonedCartRecovery,
  sendAbandonedCartRecovery,
  sendManualAbandonedCartRecovery,
};
