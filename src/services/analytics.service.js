const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');

const TRACKED_PATH_PREFIXES = [
  '/',
  '/product',
  '/category',
  '/search',
  '/checkout',
  '/about',
  '/privacy',
  '/refunds',
  '/login',
  '/account',
  '/maintenance',
];

function isTrackablePath(path) {
  const normalized = String(path || '').trim();
  if (!normalized || normalized.startsWith('/dashboard')) return false;
  if (normalized.startsWith('/api') || normalized.startsWith('/cdn')) return false;
  return TRACKED_PATH_PREFIXES.some((prefix) =>
    prefix === '/' ? normalized === '/' : normalized.startsWith(prefix)
  );
}

function isStoreVisitTableMissing(error) {
  return error?.code === 'P2021' && String(error?.meta?.table || '').includes('StoreVisit');
}

async function safeStoreVisitQuery(fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    if (isStoreVisitTableMissing(error)) {
      console.warn('[analytics] Tabela StoreVisit ausente. Execute: pnpm prisma:push');
      return fallback;
    }
    throw error;
  }
}

async function countUniqueVisitors(start, end) {
  return safeStoreVisitQuery(async () => {
    const rows = await prisma.storeVisit.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        path: { not: { startsWith: '/dashboard' } },
      },
      distinct: ['visitorId'],
      select: { visitorId: true },
    });

    return rows.length;
  }, 0);
}

async function listVisitsInRange(start, end) {
  return safeStoreVisitQuery(
    () => prisma.storeVisit.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        path: { not: { startsWith: '/dashboard' } },
      },
      select: {
        visitorId: true,
        createdAt: true,
      },
    }),
    []
  );
}

async function recordVisit(payload) {
  const visitorId = sanitizeString(payload.visitorId || '', 80);
  const path = sanitizeString(payload.path || '', 300);
  const referrer = sanitizeString(payload.referrer || '', 500) || null;
  const userAgent = sanitizeString(payload.userAgent || '', 512) || null;
  const userId = payload.userId ? sanitizeString(payload.userId, 80) : null;

  if (!visitorId || visitorId.length < 8) {
    throw new Error('Identificador de visitante inválido');
  }
  if (!path || !isTrackablePath(path)) {
    throw new Error('Página não rastreável');
  }

  const recentDuplicate = await safeStoreVisitQuery(
    () => prisma.storeVisit.findFirst({
      where: {
        visitorId,
        path,
        createdAt: { gte: new Date(Date.now() - 30_000) },
      },
      select: { id: true },
    }),
    null
  );

  if (recentDuplicate) {
    return { recorded: false, reason: 'deduplicated' };
  }

  await safeStoreVisitQuery(
    () => prisma.storeVisit.create({
      data: {
        visitorId,
        path,
        referrer,
        userAgent,
        userId,
      },
    }),
    null
  );

  return { recorded: true };
}

async function listAllVisitsBefore(end) {
  return safeStoreVisitQuery(
    () => prisma.storeVisit.findMany({
      where: { createdAt: { lt: end } },
      select: { visitorId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    []
  );
}

module.exports = {
  isTrackablePath,
  countUniqueVisitors,
  listVisitsInRange,
  listAllVisitsBefore,
  recordVisit,
};
