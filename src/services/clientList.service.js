const { prisma } = require('../config/prisma');

const PAGE_SIZE = 20;

const SORT_MAP = {
  spent_desc: '"totalSpent" DESC, u."createdAt" DESC',
  spent_asc: '"totalSpent" ASC, u."createdAt" DESC',
  orders_desc: '"ordersCount" DESC, u."createdAt" DESC',
  created_desc: 'u."createdAt" DESC',
  last_access_desc: 'u."lastAccessAt" DESC NULLS LAST, u."createdAt" DESC',
  name_asc: 'LOWER(COALESCE(u.name, u.email, \'\')) ASC',
};

function buildClientListFilters({ search, purchases, access, roleType }) {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (search) {
    const term = String(search).trim();
    const digits = term.replace(/\D/g, '');
    const parts = [`(LOWER(u.name) LIKE LOWER($${idx}) OR LOWER(u.email) LIKE LOWER($${idx}))`];
    params.push(`%${term}%`);
    idx += 1;
    if (digits.length >= 4) {
      parts.push(`u.phone LIKE $${idx}`);
      parts.push(`u.document LIKE $${idx}`);
      params.push(`%${digits}%`);
      idx += 1;
    }
    conditions.push(`(${parts.join(' OR ')})`);
  }

  if (roleType === 'customer') {
    conditions.push('u."roleId" IS NULL AND u."isAdmin" = false');
  } else if (roleType === 'team') {
    conditions.push('(u."roleId" IS NOT NULL OR u."isAdmin" = true)');
  }

  if (access === 'recent') {
    conditions.push(`u."lastAccessAt" >= NOW() - INTERVAL '7 days'`);
  } else if (access === 'never') {
    conditions.push('u."lastAccessAt" IS NULL');
  }

  let having = '';
  if (purchases === 'with') {
    having = 'HAVING COUNT(CASE WHEN o.status IN (\'PAID\',\'DELIVERED\') THEN o.id END) > 0';
  } else if (purchases === 'without') {
    having = 'HAVING COUNT(CASE WHEN o.status IN (\'PAID\',\'DELIVERED\') THEN o.id END) = 0';
  }

  return { whereSql: conditions.join(' AND '), params, having, nextIdx: idx };
}

async function listClientsPaginated(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = PAGE_SIZE;
  const skip = (page - 1) * pageSize;
  const sort = SORT_MAP[query.sort] ? query.sort : 'created_desc';
  const orderSql = SORT_MAP[sort];
  const { whereSql, params, having, nextIdx } = buildClientListFilters({
    search: query.search,
    purchases: query.purchases,
    access: query.access,
    roleType: query.roleType,
  });

  const baseFrom = `
    FROM "User" u
    LEFT JOIN "Order" o ON o."userId" = u.id
    WHERE ${whereSql}
    GROUP BY u.id
    ${having}
  `;

  const listSql = `
    SELECT
      u.id,
      COALESCE(SUM(CASE WHEN o.status IN ('PAID','DELIVERED') THEN o.total ELSE 0 END), 0)::int AS "totalSpent",
      COUNT(CASE WHEN o.status IN ('PAID','DELIVERED') THEN o.id END)::int AS "ordersCount",
      COALESCE(SUM(CASE WHEN o.status IN ('PAID','DELIVERED') THEN o.discount ELSE 0 END), 0)::int AS "totalDiscounts"
    ${baseFrom}
    ORDER BY ${orderSql}
    LIMIT $${nextIdx} OFFSET $${nextIdx + 1}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total FROM (
      SELECT u.id
      ${baseFrom}
    ) AS grouped
  `;

  const listParams = [...params, pageSize, skip];
  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe(listSql, ...listParams),
    prisma.$queryRawUnsafe(countSql, ...params),
  ]);

  const total = Number(countRows?.[0]?.total || 0);
  const ids = rows.map((r) => r.id);
  if (!ids.length) {
    return { clients: [], total, page, totalPages: Math.ceil(total / pageSize) };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      createdAt: true,
      lastAccessAt: true,
      phone: true,
      document: true,
      provider: true,
      isAdmin: true,
      roleId: true,
      role: { select: { id: true, name: true } },
      orders: {
        where: { status: { in: ['PAID', 'DELIVERED'] } },
        select: { id: true, total: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));
  const itemStats = await prisma.orderItem.groupBy({
    by: ['orderId'],
    where: { order: { userId: { in: ids }, status: { in: ['PAID', 'DELIVERED'] } } },
    _sum: { quantity: true },
  });

  const orderUserMap = new Map();
  if (itemStats.length) {
    const orders = await prisma.order.findMany({
      where: { id: { in: itemStats.map((i) => i.orderId) } },
      select: { id: true, userId: true },
    });
    for (const o of orders) orderUserMap.set(o.id, o.userId);
  }

  const itemsByUser = new Map(ids.map((id) => [id, 0]));
  for (const row of itemStats) {
    const userId = orderUserMap.get(row.orderId);
    if (!userId) continue;
    itemsByUser.set(userId, (itemsByUser.get(userId) || 0) + (row._sum.quantity || 0));
  }

  const aggMap = new Map(rows.map((r) => [r.id, r]));

  const clients = ids.map((id) => {
    const u = userMap.get(id);
    const agg = aggMap.get(id);
    if (!u) return null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      createdAt: u.createdAt,
      lastAccessAt: u.lastAccessAt,
      phone: u.phone,
      document: u.document,
      provider: u.provider,
      isAdmin: u.isAdmin,
      roleId: u.roleId,
      role: u.role,
      recentOrders: u.orders,
      ordersCount: agg?.ordersCount || 0,
      totalSpent: agg?.totalSpent || 0,
      totalItemsCount: itemsByUser.get(id) || 0,
      totalDiscounts: agg?.totalDiscounts || 0,
    };
  }).filter(Boolean);

  return {
    clients,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
  };
}

module.exports = {
  listClientsPaginated,
};
