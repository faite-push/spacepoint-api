const { prisma } = require('../config/prisma');
const emailService = require('./email.service');
const { abandonedProductRecoveryEmail, withEmailLayout } = require('../utils/emailTemplates');
const {
  ensureProductInterestToken,
  formatProductRecoveryUrl,
} = require('./marketingAutomations.service');
const { getEmailTemplates } = require('../utils/emailTemplatesSettings');
const { priceToCents } = require('../utils/productStore');
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
      console.error(`[abandonedProductEmail.${taskName}]`, err.message);
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

async function claimProductEmailDelay(interestId, delayHours) {
  const hours = Number(delayHours) || 1;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, "recoveryEmailsSent", "recoveryEmailSentAt", "convertedAt", "archivedAt"
      FROM "AbandonedProductInterest"
      WHERE id = ${interestId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row || row.convertedAt || row.archivedAt) return false;
    const sentMap = parseSentMap(row.recoveryEmailsSent, row.recoveryEmailSentAt, hours);
    if (sentMap[hours]) return false;
    const nextMap = mergeSentMap(sentMap, hours);
    await tx.abandonedProductInterest.update({
      where: { id: interestId },
      data: {
        recoveryEmailSentAt: row.recoveryEmailSentAt || new Date(),
        recoveryEmailsSent: nextMap,
      },
    });
    return true;
  });
}

async function releaseProductEmailDelay(interestId, delayHours) {
  const hours = Number(delayHours) || 1;
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT id, "recoveryEmailsSent", "recoveryEmailSentAt"
        FROM "AbandonedProductInterest"
        WHERE id = ${interestId}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) return;
      const sentMap = parseSentMap(row.recoveryEmailsSent, row.recoveryEmailSentAt, hours);
      const nextMap = removeSentDelay(sentMap, hours);
      await tx.abandonedProductInterest.update({
        where: { id: interestId },
        data: {
          recoveryEmailsSent: Object.keys(nextMap).length ? nextMap : null,
          recoveryEmailSentAt:
            Object.keys(nextMap).length > 0 ? row.recoveryEmailSentAt || new Date() : null,
        },
      });
    });
  } catch (err) {
    console.error('[abandonedProductEmail.releaseProductEmailDelay]', err.message);
  }
}

async function loadInterestContext(interestId, { delayHours, stepIndex } = {}) {
  const interest = await prisma.abandonedProductInterest.findUnique({
    where: { id: interestId },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          price: true,
          isActive: true,
          isVisible: true,
        },
      },
      variant: {
        select: { id: true, name: true, price: true, imageUrl: true },
      },
      user: { select: { name: true, email: true } },
    },
  });

  if (
    !interest ||
    interest.convertedAt ||
    interest.archivedAt ||
    !interest.product?.isActive ||
    !interest.product?.isVisible
  ) {
    return null;
  }

  if (delayHours) {
    const sentMap = parseSentMap(
      interest.recoveryEmailsSent,
      interest.recoveryEmailSentAt,
      delayHours
    );
    if (sentMap[delayHours]) return null;
  }

  const customerEmail = interest.email || interest.user?.email;
  if (!isValidEmail(customerEmail)) return null;

  const token = await ensureProductInterestToken(interestId);
  if (!token) return null;

  const branding = await loadSiteBranding();
  const unitPrice = interest.variant
    ? priceToCents(interest.variant.price)
    : priceToCents(interest.product.price);
  const label = interest.variant?.name
    ? `${interest.product.name} — ${interest.variant.name}`
    : interest.product.name;
  const imageUrl = resolveMediaUrl(interest.variant?.imageUrl || interest.product.imageUrl || null);

  const trackBase = API_PUBLIC_URL || FRONTEND_URL;
  const productUrl = `${trackBase}/v2/api/marketing/track/click/${token}`;
  const openPixelUrl = `${trackBase}/v2/api/marketing/track/open/${token}.gif`;

  return withEmailLayout(
    {
      interest,
      storeName: branding.storeName,
      logoUrl: branding.logoUrl,
      logoWhiteUrl: branding.logoWhiteUrl,
      contactEmail: branding.contactEmail,
      customBodies: branding.customBodies,
      customSubjects: branding.customSubjects,
      customPreheaders: branding.customPreheaders,
      customerName: interest.customerName || interest.user?.name || 'Cliente',
      customerEmail,
      items: [
        {
          label,
          quantity: 1,
          unitPrice,
          imageUrl,
        },
      ],
      unitPrice,
      productUrl,
      openPixelUrl,
      storeUrl: branding.storeUrl || FRONTEND_URL,
      recoveryUrl: formatProductRecoveryUrl(interest.product.slug, 'email'),
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

async function sendAbandonedProductRecovery(interestId, step = {}) {
  const delayHours = step.delayHours || 1;
  const stepIndex = step.stepIndex || 1;

  const ctx = await loadInterestContext(interestId, { delayHours, stepIndex });
  if (!ctx) return { sent: false };

  const claimed = await claimProductEmailDelay(interestId, delayHours);
  if (!claimed) return { sent: false };

  try {
    const template = abandonedProductRecoveryEmail({
      storeName: ctx.storeName,
      customerName: ctx.customerName,
      items: ctx.items,
      unitPrice: ctx.unitPrice,
      productUrl: ctx.productUrl,
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
      await releaseProductEmailDelay(interestId, delayHours);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    await releaseProductEmailDelay(interestId, delayHours);
    throw err;
  }
}

function notifyAbandonedProductRecovery(interestId, step = {}) {
  queueEmail('notifyAbandonedProductRecovery', async () => {
    await sendAbandonedProductRecovery(interestId, step);
  });
}

module.exports = {
  notifyAbandonedProductRecovery,
  sendAbandonedProductRecovery,
};
