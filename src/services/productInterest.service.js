const { prisma } = require('../config/prisma');
const { visibleVariantWhere } = require('../utils/productStore');

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeEmail(email) {
  if (!isValidEmail(email)) return null;
  return email.trim().toLowerCase();
}

/**
 * Registra (ou atualiza) interesse em um produto visto na PDP.
 * Só dispara e-mail depois, via cron — aqui apenas captura a view.
 */
async function trackProductView({
  visitorId,
  productId,
  variantId,
  email,
  customerName,
  userId,
  userEmail,
  userName,
}) {
  const resolvedVisitorId = String(visitorId || '').trim();
  const resolvedProductId = String(productId || '').trim();

  if (!resolvedVisitorId || !resolvedProductId) {
    const err = new Error('visitorId e productId são obrigatórios');
    err.status = 400;
    throw err;
  }

  const product = await prisma.product.findFirst({
    where: { id: resolvedProductId, isActive: true, isVisible: true },
    include: {
      variants: {
        where: visibleVariantWhere(),
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!product) {
    const err = new Error('Produto não encontrado');
    err.status = 404;
    throw err;
  }

  let resolvedVariantId = variantId ? String(variantId).trim() : null;
  if (resolvedVariantId) {
    const variant = product.variants.find((v) => v.id === resolvedVariantId);
    if (!variant) resolvedVariantId = null;
  }

  // Se o visitante já tem carrinho ativo com itens, não vale a pena rastrear abandono de produto
  const activeCart = await prisma.abandonedCart.findFirst({
    where: {
      convertedAt: null,
      archivedAt: null,
      OR: [
        ...(userId ? [{ userId }] : []),
        { visitorId: resolvedVisitorId },
      ],
      items: { some: {} },
    },
    select: { id: true },
  });
  if (activeCart) {
    return { tracked: false, reason: 'active_cart' };
  }

  const resolvedEmail = normalizeEmail(email) || normalizeEmail(userEmail);
  const resolvedName = String(customerName || userName || '').trim() || null;

  const existing = await prisma.abandonedProductInterest.findUnique({
    where: {
      visitorId_productId: {
        visitorId: resolvedVisitorId,
        productId: product.id,
      },
    },
  });

  const data = {
    userId: userId || existing?.userId || null,
    visitorId: resolvedVisitorId,
    productId: product.id,
    variantId: resolvedVariantId || existing?.variantId || null,
    lastViewedAt: new Date(),
    convertedAt: null,
    archivedAt: null,
    ...(resolvedEmail ? { email: resolvedEmail } : {}),
    ...(resolvedName ? { customerName: resolvedName } : {}),
    // Se voltou a ver depois de já ter recebido e-mail, permite novo ciclo
    ...(existing?.recoveryEmailSentAt && existing?.convertedAt
      ? {
          recoveryEmailSentAt: null,
          recoveryEmailsSent: {},
          emailOpenedAt: null,
          emailClickedAt: null,
        }
      : {}),
  };

  if (existing) {
    // Não reabre ciclo se e-mail já foi enviado e ainda não converteu
    const patch = { ...data };
    if (existing.recoveryEmailSentAt && !existing.convertedAt) {
      delete patch.recoveryEmailSentAt;
    }
    const updated = await prisma.abandonedProductInterest.update({
      where: { id: existing.id },
      data: patch,
    });
    return { tracked: true, id: updated.id };
  }

  const created = await prisma.abandonedProductInterest.create({ data });
  return { tracked: true, id: created.id };
}

/** Arquiva interesses dos produtos que entraram no carrinho (exclusão mútua). */
async function archiveInterestsForCartItems({ visitorId, userId, productIds }) {
  const ids = [...new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return { archived: 0 };

  const or = [];
  if (visitorId) or.push({ visitorId: String(visitorId) });
  if (userId) or.push({ userId: String(userId) });
  if (!or.length) return { archived: 0 };

  const result = await prisma.abandonedProductInterest.updateMany({
    where: {
      productId: { in: ids },
      convertedAt: null,
      archivedAt: null,
      OR: or,
    },
    data: { archivedAt: new Date() },
  });

  return { archived: result.count };
}

async function listRecoverableInterestJobs({ delays, limit = 50 }) {
  const { parseSentMap, nextDueDelay } = require('../utils/recoverySequence');
  const delayList = Array.isArray(delays) && delays.length ? delays : [1];
  const minDelay = Math.min(...delayList);
  const maxDelay = Math.max(...delayList);
  const cutoff = new Date(Date.now() - minDelay * 60 * 60 * 1000);
  const maxCutoff = new Date(Date.now() - maxDelay * 60 * 60 * 1000);

  const rows = await prisma.abandonedProductInterest.findMany({
    where: {
      convertedAt: null,
      archivedAt: null,
      email: { not: null },
      lastViewedAt: { lte: cutoff },
      product: { isActive: true, isVisible: true },
    },
    select: {
      id: true,
      userId: true,
      visitorId: true,
      email: true,
      productId: true,
      lastViewedAt: true,
      recoveryEmailSentAt: true,
      recoveryEmailsSent: true,
    },
    orderBy: { lastViewedAt: 'asc' },
    take: limit * 3,
  });

  if (!rows.length) return [];

  const jobs = [];
  for (const row of rows) {
    const activeCart = await prisma.abandonedCart.findFirst({
      where: {
        convertedAt: null,
        archivedAt: null,
        OR: [
          ...(row.userId ? [{ userId: row.userId }] : []),
          ...(row.visitorId ? [{ visitorId: row.visitorId }] : []),
          ...(row.email ? [{ email: row.email }] : []),
        ],
        items: { some: {} },
      },
      select: { id: true },
    });
    if (activeCart) {
      await prisma.abandonedProductInterest.update({
        where: { id: row.id },
        data: { archivedAt: new Date() },
      });
      continue;
    }

    if (row.userId) {
      const recentOrder = await prisma.order.findFirst({
        where: {
          userId: row.userId,
          status: { in: ['PENDING', 'PAID', 'DELIVERED'] },
          createdAt: { gte: maxCutoff },
          items: { some: { productId: row.productId } },
        },
        select: { id: true },
      });
      if (recentOrder) {
        await prisma.abandonedProductInterest.update({
          where: { id: row.id },
          data: { convertedAt: new Date() },
        });
        continue;
      }
    }

    const sentMap = parseSentMap(
      row.recoveryEmailsSent,
      row.recoveryEmailSentAt,
      minDelay
    );
    const due = nextDueDelay({
      delays: delayList,
      sentMap,
      anchorDate: row.lastViewedAt,
    });
    if (!due) continue;

    jobs.push({
      interestId: row.id,
      delayHours: due.delayHours,
      stepIndex: due.stepIndex,
      stepTotal: due.stepTotal,
    });
    if (jobs.length >= limit) break;
  }

  return jobs;
}

/** @deprecated use listRecoverableInterestJobs */
async function listRecoverableInterestIds(opts) {
  const jobs = await listRecoverableInterestJobs({
    delays: [opts.delayHours || 1],
    limit: opts.limit,
  });
  return jobs.map((j) => j.interestId);
}

/** Marca interesses convertidos quando o usuário cria pedido com aqueles produtos. */
async function markConvertedForOrder({ userId, email, productIds }) {
  const ids = [...new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return { converted: 0 };

  const or = [];
  if (userId) or.push({ userId: String(userId) });
  const normalized = normalizeEmail(email);
  if (normalized) or.push({ email: normalized });
  if (!or.length) return { converted: 0 };

  const result = await prisma.abandonedProductInterest.updateMany({
    where: {
      productId: { in: ids },
      convertedAt: null,
      OR: or,
    },
    data: { convertedAt: new Date(), archivedAt: null },
  });

  return { converted: result.count };
}

module.exports = {
  trackProductView,
  archiveInterestsForCartItems,
  listRecoverableInterestIds,
  listRecoverableInterestJobs,
  markConvertedForOrder,
};
