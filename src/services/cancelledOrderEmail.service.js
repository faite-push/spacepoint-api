const { prisma } = require('../config/prisma');
const emailService = require('./email.service');
const { cancelledOrderRecoveryEmail, withEmailLayout } = require('../utils/emailTemplates');
const {
  ensureCancelledOrderToken,
  formatCancelledOrderRecoveryUrl,
  AUTOMATION_HIDDEN_NOTE,
  PAYMENT_RECOVERY_CANCEL_NOTES,
} = require('./marketingAutomations.service');
const { getEmailTemplates } = require('../utils/emailTemplatesSettings');
const { resolveMediaUrl } = require('../utils/mediaUrl');
const {
  parseSentMap,
  mergeSentMap,
  removeSentDelay,
} = require('../utils/recoverySequence');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || process.env.BACKEND_URL || '').replace(/\/$/, '');

function queueEmail(taskName, fn) {
  setImmediate(async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[cancelledOrderEmail.${taskName}]`, err.message);
    }
  });
}

async function claimCancelledEmailDelay(orderId, delayHours) {
  const hours = Number(delayHours) || 1;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, "cancelledRecoveryEmailsSent", "cancelledRecoveryEmailSentAt",
             "cancelledRecoveryConvertedAt", status
      FROM "Order"
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    const order = rows[0];
    if (!order || order.status !== 'CANCELLED' || order.cancelledRecoveryConvertedAt) {
      return false;
    }
    const sentMap = parseSentMap(
      order.cancelledRecoveryEmailsSent,
      order.cancelledRecoveryEmailSentAt,
      hours
    );
    if (sentMap[hours]) return false;
    const nextMap = mergeSentMap(sentMap, hours);
    await tx.order.update({
      where: { id: orderId },
      data: {
        cancelledRecoveryEmailSentAt: order.cancelledRecoveryEmailSentAt || new Date(),
        cancelledRecoveryEmailsSent: nextMap,
      },
    });
    return true;
  });
}

async function releaseCancelledEmailDelay(orderId, delayHours) {
  const hours = Number(delayHours) || 1;
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT id, "cancelledRecoveryEmailsSent", "cancelledRecoveryEmailSentAt"
        FROM "Order"
        WHERE id = ${orderId}
        FOR UPDATE
      `;
      const order = rows[0];
      if (!order) return;
      const sentMap = parseSentMap(
        order.cancelledRecoveryEmailsSent,
        order.cancelledRecoveryEmailSentAt,
        hours
      );
      const nextMap = removeSentDelay(sentMap, hours);
      await tx.order.update({
        where: { id: orderId },
        data: {
          cancelledRecoveryEmailsSent: Object.keys(nextMap).length ? nextMap : null,
          cancelledRecoveryEmailSentAt:
            Object.keys(nextMap).length > 0
              ? order.cancelledRecoveryEmailSentAt || new Date()
              : null,
        },
      });
    });
  } catch (err) {
    console.error('[cancelledOrderEmail.releaseCancelledEmailDelay]', err.message);
  }
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function extractCheckoutEmail(checkoutData) {
  if (!checkoutData || typeof checkoutData !== 'object') return null;
  return checkoutData.email || checkoutData.customerEmail || null;
}

function extractCheckoutName(checkoutData) {
  if (!checkoutData || typeof checkoutData !== 'object') return null;
  return checkoutData.name || checkoutData.customerName || null;
}

function isPaymentRelatedCancel(adminNotes) {
  const notes = String(adminNotes || '');
  if (notes.includes(AUTOMATION_HIDDEN_NOTE)) return false;
  // Sem nota: elegível (cancelamento genérico / expiração)
  if (!notes.trim()) return true;
  const paymentRelated = PAYMENT_RECOVERY_CANCEL_NOTES.some((hint) =>
    notes.toLowerCase().includes(hint.toLowerCase())
  );
  const adminCancel = /cancelado pelo administrador|cancelado em massa/i.test(notes);
  return paymentRelated || adminCancel;
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

async function listRecoverableCancelledOrderJobs({ delays, limit = 50 }) {
  const { parseSentMap, nextDueDelay } = require('../utils/recoverySequence');
  const delayList = Array.isArray(delays) && delays.length ? delays : [1];
  const minDelay = Math.min(...delayList);
  const cutoff = new Date(Date.now() - minDelay * 60 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      status: 'CANCELLED',
      updatedAt: { lte: cutoff },
      cancelledRecoveryConvertedAt: null,
      NOT: {
        adminNotes: { contains: AUTOMATION_HIDDEN_NOTE },
      },
    },
    select: {
      id: true,
      userId: true,
      adminNotes: true,
      updatedAt: true,
      checkoutData: true,
      cancelledRecoveryEmailSentAt: true,
      cancelledRecoveryEmailsSent: true,
      user: { select: { email: true } },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit * 3,
  });

  const jobs = [];
  for (const order of orders) {
    if (!isPaymentRelatedCancel(order.adminNotes)) continue;

    const email = extractCheckoutEmail(order.checkoutData) || order.user?.email;
    if (!isValidEmail(email)) continue;

    const laterOrder = await prisma.order.findFirst({
      where: {
        userId: order.userId,
        status: { in: ['PENDING', 'PAID', 'DELIVERED'] },
        createdAt: { gt: order.updatedAt },
      },
      select: { id: true },
    });
    if (laterOrder) {
      await prisma.order.update({
        where: { id: order.id },
        data: { cancelledRecoveryConvertedAt: new Date() },
      });
      continue;
    }

    const sentMap = parseSentMap(
      order.cancelledRecoveryEmailsSent,
      order.cancelledRecoveryEmailSentAt,
      minDelay
    );
    const due = nextDueDelay({
      delays: delayList,
      sentMap,
      anchorDate: order.updatedAt,
    });
    if (!due) continue;

    jobs.push({
      orderId: order.id,
      delayHours: due.delayHours,
      stepIndex: due.stepIndex,
      stepTotal: due.stepTotal,
    });
    if (jobs.length >= limit) break;
  }

  return jobs;
}

/** @deprecated use listRecoverableCancelledOrderJobs */
async function listRecoverableCancelledOrderIds(opts) {
  const jobs = await listRecoverableCancelledOrderJobs({
    delays: [opts.delayHours || 1],
    limit: opts.limit,
  });
  return jobs.map((j) => j.orderId);
}

async function loadOrderContext(orderId, { delayHours, stepIndex } = {}) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { name: true, email: true } },
      items: {
        include: {
          product: { select: { name: true, imageUrl: true } },
          variant: { select: { name: true, imageUrl: true } },
        },
      },
    },
  });

  if (
    !order ||
    order.status !== 'CANCELLED' ||
    order.cancelledRecoveryConvertedAt ||
    (order.adminNotes || '').includes(AUTOMATION_HIDDEN_NOTE)
  ) {
    return null;
  }

  if (delayHours) {
    const sentMap = parseSentMap(
      order.cancelledRecoveryEmailsSent,
      order.cancelledRecoveryEmailSentAt,
      delayHours
    );
    if (sentMap[delayHours]) return null;
  }

  const customerEmail = extractCheckoutEmail(order.checkoutData) || order.user?.email;
  if (!isValidEmail(customerEmail)) return null;

  const token = await ensureCancelledOrderToken(orderId);
  if (!token) return null;

  const branding = await loadSiteBranding();
  const items = order.items.map((item) => {
    const variantLabel = item.variantName || item.variant?.name;
    return {
      label: variantLabel ? `${item.product.name} — ${variantLabel}` : item.product.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      imageUrl: resolveMediaUrl(item.variant?.imageUrl || item.product.imageUrl || null),
    };
  });

  const trackBase = API_PUBLIC_URL || FRONTEND_URL;
  const storeUrl = `${trackBase}/v2/api/marketing/track/click/${token}`;
  const openPixelUrl = `${trackBase}/v2/api/marketing/track/open/${token}.gif`;
  const reason = String(order.adminNotes || 'Pedido cancelado')
    .replace(AUTOMATION_HIDDEN_NOTE, '')
    .trim() || 'Pedido cancelado';

  return withEmailLayout(
    {
      order,
      storeName: branding.storeName,
      logoUrl: branding.logoUrl,
      logoWhiteUrl: branding.logoWhiteUrl,
      contactEmail: branding.contactEmail,
      customBodies: branding.customBodies,
      customSubjects: branding.customSubjects,
      customPreheaders: branding.customPreheaders,
      customerName:
        extractCheckoutName(order.checkoutData) || order.user?.name || 'Cliente',
      customerEmail,
      orderId: order.id,
      items,
      total: order.total,
      reason,
      storeUrl,
      openPixelUrl,
      recoveryUrl: formatCancelledOrderRecoveryUrl(token, 'email'),
      stepIndex: stepIndex || 1,
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

async function sendCancelledOrderRecovery(orderId, step = {}) {
  const delayHours = step.delayHours || 1;
  const stepIndex = step.stepIndex || 1;

  const ctx = await loadOrderContext(orderId, { delayHours, stepIndex });
  if (!ctx) return { sent: false };

  const claimed = await claimCancelledEmailDelay(orderId, delayHours);
  if (!claimed) return { sent: false };

  try {
    const template = cancelledOrderRecoveryEmail({
      storeName: ctx.storeName,
      customerName: ctx.customerName,
      orderId: ctx.orderId,
      items: ctx.items,
      total: ctx.total,
      reason: ctx.reason,
      storeUrl: ctx.storeUrl,
      openPixelUrl: ctx.openPixelUrl,
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
      await releaseCancelledEmailDelay(orderId, delayHours);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    await releaseCancelledEmailDelay(orderId, delayHours);
    throw err;
  }
}

function notifyCancelledOrderRecovery(orderId, step = {}) {
  queueEmail('notifyCancelledOrderRecovery', async () => {
    await sendCancelledOrderRecovery(orderId, step);
  });
}

/** Marca conversão quando o usuário cria um novo pedido após recovery. */
async function markCancelledRecoveryConverted(userId) {
  if (!userId) return;
  const prev = await prisma.order.findFirst({
    where: {
      userId,
      status: 'CANCELLED',
      cancelledRecoveryEmailSentAt: { not: null },
      cancelledRecoveryConvertedAt: null,
    },
    orderBy: { cancelledRecoveryEmailSentAt: 'desc' },
    select: { id: true },
  });
  if (!prev) return;
  await prisma.order.update({
    where: { id: prev.id },
    data: { cancelledRecoveryConvertedAt: new Date() },
  });
}

module.exports = {
  listRecoverableCancelledOrderIds,
  listRecoverableCancelledOrderJobs,
  notifyCancelledOrderRecovery,
  markCancelledRecoveryConverted,
};
