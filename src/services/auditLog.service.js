const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');

const AUDIT_ACTIONS = {
  ORDER_REFUND: 'ORDER_REFUND',
  PRODUCT_PRICE_CHANGE: 'PRODUCT_PRICE_CHANGE',
  VARIANT_PRICE_CHANGE: 'VARIANT_PRICE_CHANGE',
  PRODUCT_PRICE_BULK_CHANGE: 'PRODUCT_PRICE_BULK_CHANGE',
  ORDER_ITEM_DELIVERED: 'ORDER_ITEM_DELIVERED',
};

function requestContext(req) {
  if (!req) return {};

  return {
    actorUserId: req.user?.id || null,
    ip: req.ip || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null,
    userAgent: sanitizeString(req.headers?.['user-agent'] || '', 512) || null,
  };
}

async function recordAdminAction({
  action,
  actorUserId = null,
  targetType = null,
  targetId = null,
  metadata = null,
  ip = null,
  userAgent = null,
  tx = null,
}) {
  const client = tx || prisma;

  try {
    await client.adminAuditLog.create({
      data: {
        action,
        actorUserId,
        targetType,
        targetId,
        metadata: metadata || undefined,
        ip,
        userAgent,
      },
    });
  } catch (err) {
    console.error('[auditLog.recordAdminAction]', err.message);
  }
}

function decimalChanged(before, after) {
  if (before === undefined || after === undefined) return false;
  const a = Number(before);
  const b = Number(after);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a !== b;
}

function buildPriceChangeMetadata(existing, next, extra = {}) {
  const metadata = { ...extra };
  let changed = false;

  if (decimalChanged(existing.price, next.price)) {
    metadata.oldPrice = Number(existing.price);
    metadata.newPrice = Number(next.price);
    changed = true;
  }

  if (decimalChanged(existing.comparePrice, next.comparePrice)) {
    metadata.oldComparePrice =
      existing.comparePrice == null ? null : Number(existing.comparePrice);
    metadata.newComparePrice = next.comparePrice == null ? null : Number(next.comparePrice);
    changed = true;
  }

  return changed ? metadata : null;
}

async function listAdminAuditLogs({
  action,
  actorUserId,
  targetId,
  from,
  to,
  page = 1,
  limit = 30,
}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 30));
  const skip = (pageNum - 1) * pageSize;

  const where = {};

  if (action) where.action = action;
  if (actorUserId) where.actorUserId = actorUserId;
  if (targetId) where.targetId = targetId;

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        actor: { select: { id: true, name: true, email: true, image: true } },
      },
    }),
    prisma.adminAuditLog.count({ where }),
  ]);

  return {
    logs: rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: row.metadata,
      ip: row.ip,
      createdAt: row.createdAt,
      actor: row.actor,
    })),
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

module.exports = {
  AUDIT_ACTIONS,
  requestContext,
  recordAdminAction,
  buildPriceChangeMetadata,
  listAdminAuditLogs,
};
