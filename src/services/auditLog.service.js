const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');

const AUDIT_ACTIONS = {
  ORDER_REFUND: 'ORDER_REFUND',
  ORDER_ITEM_DELIVERED: 'ORDER_ITEM_DELIVERED',

  PRODUCT_CREATE: 'PRODUCT_CREATE',
  PRODUCT_DELETE: 'PRODUCT_DELETE',
  PRODUCT_NAME_CHANGE: 'PRODUCT_NAME_CHANGE',
  PRODUCT_PRICE_CHANGE: 'PRODUCT_PRICE_CHANGE',
  PRODUCT_UPDATE: 'PRODUCT_UPDATE',
  PRODUCT_PRICE_BULK_CHANGE: 'PRODUCT_PRICE_BULK_CHANGE',

  VARIANT_CREATE: 'VARIANT_CREATE',
  VARIANT_DELETE: 'VARIANT_DELETE',
  VARIANT_NAME_CHANGE: 'VARIANT_NAME_CHANGE',
  VARIANT_PRICE_CHANGE: 'VARIANT_PRICE_CHANGE',
  VARIANT_UPDATE: 'VARIANT_UPDATE',

  CATEGORY_CREATE: 'CATEGORY_CREATE',
  CATEGORY_UPDATE: 'CATEGORY_UPDATE',
  CATEGORY_DELETE: 'CATEGORY_DELETE',

  COUPON_CREATE: 'COUPON_CREATE',
  COUPON_UPDATE: 'COUPON_UPDATE',
  COUPON_DELETE: 'COUPON_DELETE',

  ROLE_CREATE: 'ROLE_CREATE',
  ROLE_UPDATE: 'ROLE_UPDATE',
  ROLE_DELETE: 'ROLE_DELETE',
  TEAM_ROLE_ASSIGN: 'TEAM_ROLE_ASSIGN',

  PLUGIN_UPDATE: 'PLUGIN_UPDATE',
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  GATEWAY_UPDATE: 'GATEWAY_UPDATE',
  BANNER_CREATE: 'BANNER_CREATE',
  BANNER_UPDATE: 'BANNER_UPDATE',
  BANNER_DELETE: 'BANNER_DELETE',
};

const ACTION_LABELS = {
  ORDER_REFUND: 'Reembolso de pedido',
  ORDER_ITEM_DELIVERED: 'Entrega manual',
  PRODUCT_CREATE: 'Produto criado',
  PRODUCT_DELETE: 'Produto excluído',
  PRODUCT_NAME_CHANGE: 'Nome de produto',
  PRODUCT_PRICE_CHANGE: 'Preço de produto',
  PRODUCT_UPDATE: 'Produto atualizado',
  PRODUCT_PRICE_BULK_CHANGE: 'Preço em massa',
  VARIANT_CREATE: 'Variante criada',
  VARIANT_DELETE: 'Variante excluída',
  VARIANT_NAME_CHANGE: 'Nome de variante',
  VARIANT_PRICE_CHANGE: 'Preço de variante',
  VARIANT_UPDATE: 'Variante atualizada',
  CATEGORY_CREATE: 'Categoria criada',
  CATEGORY_UPDATE: 'Categoria atualizada',
  CATEGORY_DELETE: 'Categoria excluída',
  COUPON_CREATE: 'Cupom criado',
  COUPON_UPDATE: 'Cupom atualizado',
  COUPON_DELETE: 'Cupom excluído',
  ROLE_CREATE: 'Cargo criado',
  ROLE_UPDATE: 'Cargo atualizado',
  ROLE_DELETE: 'Cargo excluído',
  TEAM_ROLE_ASSIGN: 'Cargo da equipe',
  PLUGIN_UPDATE: 'Plugin alterado',
  SETTINGS_UPDATE: 'Configurações',
  GATEWAY_UPDATE: 'Gateway atualizado',
  BANNER_CREATE: 'Banner criado',
  BANNER_UPDATE: 'Banner atualizado',
  BANNER_DELETE: 'Banner excluído',
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

function fieldChanged(before, after) {
  if (after === undefined) return false;
  if (before == null && after == null) return false;
  if (typeof before === 'object' || typeof after === 'object') {
    try {
      return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
    } catch {
      return before !== after;
    }
  }
  return before !== after;
}

function collectFieldChanges(existing, next, fields) {
  const changes = [];
  for (const field of fields) {
    if (!fieldChanged(existing[field], next[field])) continue;
    changes.push({
      field,
      old: existing[field] ?? null,
      new: next[field] ?? null,
    });
  }
  return changes;
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

  const [rows, total, actorIds] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            role: { select: { name: true } },
          },
        },
      },
    }),
    prisma.adminAuditLog.count({ where }),
    prisma.adminAuditLog.findMany({
      where: { actorUserId: { not: null } },
      distinct: ['actorUserId'],
      select: { actorUserId: true },
      take: 200,
    }),
  ]);

  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds.map((r) => r.actorUserId).filter(Boolean) } },
        select: { id: true, name: true, email: true, image: true },
        orderBy: { name: 'asc' },
      })
    : [];

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
    actors,
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
  ACTION_LABELS,
  requestContext,
  recordAdminAction,
  buildPriceChangeMetadata,
  collectFieldChanges,
  fieldChanged,
  listAdminAuditLogs,
};
