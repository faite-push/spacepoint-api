const { prisma } = require('../config/prisma');
const {
  countUniqueVisitors,
  listVisitsInRange,
} = require('../services/analytics.service');
const { GATEWAY_CAPABILITIES, normalizeSlug } = require('../config/gatewayCapabilities');

const PAID_STATUSES = ['PAID', 'DELIVERED'];
const LOW_STOCK_THRESHOLD = 10;
const TZ = 'America/Sao_Paulo';

function startOfDayUTC(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function pctChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function getTzParts(date, timeZone = TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: String(get('hour')).padStart(2, '0'),
  };
}

function dayBucketKey(date) {
  const p = getTzParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function hourBucketKey(date) {
  const p = getTzParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

function formatBucketLabel(date, weekly) {
  return date.toLocaleDateString('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: weekly ? 'short' : '2-digit',
  });
}

function formatHourLabel(date) {
  return date.toLocaleTimeString('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function gatewayLabel(provider) {
  const slug = normalizeSlug(String(provider || ''));
  return GATEWAY_CAPABILITIES[slug]?.label || provider || 'Outros';
}

/** PIX/Cartão a partir de metadata.type ou Order.paymentMethod — nunca pelo slug do gateway. */
function resolvePaymentMethod(payment) {
  const metaType = String(payment.metadata?.type || '').toUpperCase();
  if (metaType === 'PIX') return 'Pix';
  if (metaType === 'CARD') return 'Cartão';

  const orderMethod = String(payment.order?.paymentMethod || '').toUpperCase();
  if (orderMethod === 'PIX') return 'Pix';
  if (orderMethod === 'CARD') return 'Cartão';

  return 'Outros';
}

function resolveAvailableStock(entity, availableCodes) {
  const delivery = entity.deliveryType;
  if (delivery === 'automatic_lines' || delivery === 'mixed') {
    return availableCodes;
  }
  return entity.stockQuantity ?? 0;
}

class AdminStatsController {
  async overview(req, res) {
    try {
      const { from, to } = req.query;

      const dateEnd = to ? new Date(to) : addDays(startOfDayUTC(), 1);
      const dateStart = from ? new Date(from) : addDays(dateEnd, -7);

      const diffMs = Math.max(dateEnd.getTime() - dateStart.getTime(), 1);
      const prevStart = new Date(dateStart.getTime() - diffMs);
      const prevEnd = dateStart;

      const orderPaidWhere = {
        status: { in: PAID_STATUSES },
        createdAt: { gte: dateStart, lt: dateEnd },
      };
      const orderPaidPrevWhere = {
        status: { in: PAID_STATUSES },
        createdAt: { gte: prevStart, lt: prevEnd },
      };

      const [
        revenueCurr,
        revenuePrev,
        ordersCurr,
        ordersPrev,
        paidOrdersCount,
        pendingOrdersCount,
        visitsCurr,
        visitsPrev,
      ] = await Promise.all([
        prisma.order.aggregate({ _sum: { total: true }, where: orderPaidWhere }),
        prisma.order.aggregate({ _sum: { total: true }, where: orderPaidPrevWhere }),
        prisma.order.count({ where: orderPaidWhere }),
        prisma.order.count({ where: orderPaidPrevWhere }),
        prisma.order.count({ where: orderPaidWhere }),
        prisma.order.count({
          where: { status: 'PENDING', createdAt: { gte: dateStart, lt: dateEnd } },
        }),
        countUniqueVisitors(dateStart, dateEnd),
        countUniqueVisitors(prevStart, prevEnd),
      ]);

      const revValue = revenueCurr._sum.total ?? 0;
      const revPrevValue = revenuePrev._sum.total ?? 0;
      const salesCount = ordersCurr;
      const salesPrevCount = ordersPrev;
      const ticketValue = salesCount > 0 ? Math.floor(revValue / salesCount) : 0;
      const ticketPrevValue = salesPrevCount > 0 ? Math.floor(revPrevValue / salesPrevCount) : 0;
      const visitsValue = visitsCurr;
      const visitsPrevValue = visitsPrev;

      const [payments, ordersLocal, orderItems, visitsInRange] = await Promise.all([
        prisma.payment.findMany({
          where: { status: 'PAID', createdAt: { gte: dateStart, lt: dateEnd } },
          select: {
            amount: true,
            createdAt: true,
            userId: true,
            provider: true,
            metadata: true,
            order: { select: { paymentMethod: true } },
          },
        }),
        prisma.order.findMany({
          where: orderPaidWhere,
          select: { id: true, createdAt: true, userId: true, total: true },
        }),
        prisma.orderItem.findMany({
          where: { order: orderPaidWhere },
          select: {
            quantity: true,
            productId: true,
            order: { select: { createdAt: true } },
          },
        }),
        listVisitsInRange(dateStart, dateEnd),
      ]);

      const HOUR_MS = 60 * 60 * 1000;
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      // "Hoje" / intervalos curtos: buckets por hora (America/Sao_Paulo)
      const useHourlyBuckets = diffMs <= 36 * HOUR_MS;
      const useWeeklyBuckets = !useHourlyBuckets && diffDays > 60;
      const granularity = useHourlyBuckets ? 'hour' : useWeeklyBuckets ? 'week' : 'day';

      const emptyBucketFields = () => ({
        revenue: 0,
        sales: 0,
        unitsSold: 0,
        uniqueCustomers: new Set(),
        returningCustomers: new Set(),
        uniqueVisitors: new Set(),
        returningVisitors: new Set(),
      });

      const buckets = [];
      if (useHourlyBuckets) {
        let t = Math.floor(dateStart.getTime() / HOUR_MS) * HOUR_MS;
        while (t < dateEnd.getTime()) {
          const current = new Date(t);
          const key = hourBucketKey(current);
          if (!buckets.length || buckets[buckets.length - 1].key !== key) {
            buckets.push({
              key,
              date: current.toISOString(),
              label: formatHourLabel(current),
              ...emptyBucketFields(),
            });
          }
          t += HOUR_MS;
        }
      } else {
        let current = new Date(dateStart);
        while (current < dateEnd) {
          const key = dayBucketKey(current);
          buckets.push({
            key,
            date: current.toISOString(),
            label: formatBucketLabel(current, useWeeklyBuckets),
            ...emptyBucketFields(),
          });
          current = addDays(current, useWeeklyBuckets ? 7 : 1);
        }
      }

      const getBucketKey = (dateObj) => {
        if (useHourlyBuckets) return hourBucketKey(dateObj);
        if (!useWeeklyBuckets) return dayBucketKey(dateObj);
        const dayKey = dayBucketKey(dateObj);
        let matched = null;
        for (const b of buckets) {
          if (b.key <= dayKey) matched = b.key;
          else break;
        }
        return matched;
      };

      const bucketMap = new Map(buckets.map((b) => [b.key, b]));

      for (const o of ordersLocal) {
        const k = getBucketKey(o.createdAt);
        const b = bucketMap.get(k);
        if (!b) continue;
        b.revenue += o.total || 0;
        b.sales += 1;
      }

      for (const item of orderItems) {
        const k = getBucketKey(item.order.createdAt);
        const b = bucketMap.get(k);
        if (b) b.unitsSold += item.quantity;
      }

      const buyerIds = [...new Set(ordersLocal.map((o) => o.userId).filter(Boolean))];
      const firstOrderByUser = {};
      if (buyerIds.length) {
        const priorOrders = await prisma.order.findMany({
          where: {
            userId: { in: buyerIds },
            status: { in: PAID_STATUSES },
            createdAt: { lt: dateEnd },
          },
          select: { userId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        });
        for (const order of priorOrders) {
          if (!order.userId || firstOrderByUser[order.userId]) continue;
          firstOrderByUser[order.userId] = order.createdAt;
        }
      }

      for (const order of ordersLocal) {
        if (!order.userId) continue;
        const k = getBucketKey(order.createdAt);
        const b = bucketMap.get(k);
        if (!b) continue;

        const firstOrder = firstOrderByUser[order.userId];
        const bucketStart = new Date(b.date);
        if (firstOrder && firstOrder < bucketStart) {
          b.returningCustomers.add(order.userId);
        } else {
          b.uniqueCustomers.add(order.userId);
        }
      }

      const visitorIds = [...new Set(visitsInRange.map((v) => v.visitorId))];
      const firstSeenByVisitor = {};
      if (visitorIds.length) {
        const firstVisits = await prisma.storeVisit.groupBy({
          by: ['visitorId'],
          where: { visitorId: { in: visitorIds } },
          _min: { createdAt: true },
        }).catch(() => []);

        for (const row of firstVisits) {
          firstSeenByVisitor[row.visitorId] = row._min.createdAt;
        }
      }

      for (const visit of visitsInRange) {
        const k = getBucketKey(visit.createdAt);
        const b = bucketMap.get(k);
        if (!b) continue;

        b.uniqueVisitors.add(visit.visitorId);
        const bucketStart = new Date(b.date);
        const firstSeen = firstSeenByVisitor[visit.visitorId];
        if (firstSeen && firstSeen < bucketStart) {
          b.returningVisitors.add(visit.visitorId);
        }
      }

      const finalChart = buckets.map((b) => ({
        key: b.key,
        date: b.date,
        label: b.label,
        revenue: b.revenue / 100,
        sales: b.sales,
        unitsSold: b.unitsSold,
        uniqueCustomers: b.uniqueCustomers.size,
        returningCustomers: b.returningCustomers.size,
        uniqueVisitors: b.uniqueVisitors.size,
        returningVisitors: b.returningVisitors.size,
      }));

      const totalOrdersForApproval = paidOrdersCount + pendingOrdersCount;
      const approvedPct =
        totalOrdersForApproval > 0
          ? Math.round((paidOrdersCount / totalOrdersForApproval) * 100)
          : 0;
      const visitConversionPct =
        visitsValue > 0 ? Math.round((salesCount / visitsValue) * 1000) / 10 : null;

      const methodsAgg = {};
      const methodsCount = {};
      const gatewayAgg = {};
      for (const p of payments) {
        const gw = gatewayLabel(p.provider);
        gatewayAgg[gw] = (gatewayAgg[gw] || 0) + p.amount;
        const method = resolvePaymentMethod(p);
        methodsAgg[method] = (methodsAgg[method] || 0) + p.amount;
        methodsCount[method] = (methodsCount[method] || 0) + 1;
      }

      const methodsTotal = Object.values(methodsAgg).reduce((s, v) => s + v, 0) || 1;
      const gatewaysTotal = Object.values(gatewayAgg).reduce((s, v) => s + v, 0) || 1;

      const [
        latestOrders,
        topItemStats,
        productsForStock,
        variantsForStock,
        availableCodeGroups,
      ] = await Promise.all([
        prisma.order.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          where: {
            status: { in: ['PAID', 'DELIVERED', 'PENDING'] },
            createdAt: { gte: dateStart, lt: dateEnd },
          },
          include: { user: { select: { name: true, email: true } } },
        }),
        prisma.orderItem.groupBy({
          by: ['productId'],
          _sum: { quantity: true },
          where: { order: orderPaidWhere },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 5,
        }),
        prisma.product.findMany({
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            price: true,
            stockQuantity: true,
            deliveryType: true,
          },
          take: 200,
        }),
        prisma.productVariant.findMany({
          where: { isActive: true },
          take: 200,
          select: {
            id: true,
            name: true,
            price: true,
            stockQuantity: true,
            deliveryType: true,
            productId: true,
            product: { select: { name: true } },
          },
        }),
        prisma.productCode.groupBy({
          by: ['productId', 'variantId'],
          where: { status: 'AVAILABLE' },
          _count: { _all: true },
        }).catch(() => []),
      ]);

      const codeCountMap = new Map();
      for (const row of availableCodeGroups) {
        const key = `${row.productId}:${row.variantId ?? 'null'}`;
        codeCountMap.set(key, row._count._all);
      }

      const lowStock = [
        ...productsForStock.map((p) => {
          const codes = codeCountMap.get(`${p.id}:null`) || 0;
          const stock = resolveAvailableStock(p, codes);
          return {
            id: p.id,
            name: p.name,
            stock,
            price: Math.round(Number(p.price) * 100),
          };
        }),
        ...variantsForStock.map((v) => {
          const codes = codeCountMap.get(`${v.productId}:${v.id}`) || 0;
          const stock = resolveAvailableStock(v, codes);
          return {
            id: v.id,
            name: `${v.product.name} — ${v.name}`,
            stock,
            price: Math.round(Number(v.price) * 100),
          };
        }),
      ]
        .filter((p) => p.stock <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => a.stock - b.stock)
        .slice(0, 10);

      const topProductIds = topItemStats.map((s) => s.productId);
      const topProductsData = topProductIds.length
        ? await prisma.product.findMany({
            where: { id: { in: topProductIds } },
            select: { id: true, name: true, price: true },
          })
        : [];

      const topSellers = topItemStats.map((stat) => {
        const p = topProductsData.find((x) => x.id === stat.productId);
        return {
          id: stat.productId,
          name: p?.name || 'Produto removido',
          salesCount: stat._sum.quantity || 0,
          price: Math.round(Number(p?.price || 0) * 100),
        };
      });

      const latestSales = latestOrders.map((o) => ({
        id: o.id,
        customer: o.user?.name || o.user?.email || 'Cliente',
        value: o.total,
        time: o.createdAt,
        status:
          o.status === 'PAID' || o.status === 'DELIVERED'
            ? 'success'
            : o.status === 'PENDING'
              ? 'pending'
              : 'failed',
      }));

      return res.json({
        metrics: {
          revenue: {
            value: revValue,
            change: pctChange(revValue, revPrevValue),
            delta: revValue - revPrevValue,
          },
          sales: {
            value: salesCount,
            change: pctChange(salesCount, salesPrevCount),
            delta: salesCount - salesPrevCount,
          },
          avgTicket: {
            value: ticketValue,
            change: pctChange(ticketValue, ticketPrevValue),
            delta: ticketValue - ticketPrevValue,
          },
          visits: {
            value: visitsValue,
            change: pctChange(visitsValue, visitsPrevValue),
            delta: visitsValue - visitsPrevValue,
          },
        },
        charts: {
          granularity,
          performance: finalChart,
          // Alinhado à Ereemby: clientes compradores (únicos = 1ª compra no bucket)
          customers: finalChart.map((f) => ({
            label: f.label,
            unique: f.uniqueCustomers,
            returning: f.returningCustomers,
          })),
          visitors: finalChart.map((f) => ({
            label: f.label,
            unique: f.uniqueVisitors,
            returning: f.returningVisitors,
          })),
        },
        sidebar: {
          conversion: {
            total: revValue,
            approvedCount: paidOrdersCount,
            pendingCount: pendingOrdersCount,
            approvedPct,
            visitConversionPct,
            gaugePct: visitConversionPct != null ? Math.min(100, visitConversionPct) : approvedPct,
          },
          methods: Object.entries(methodsAgg)
            .map(([name, value]) => ({
              name,
              value,
              count: methodsCount[name] || 0,
              pct: Math.round((value / methodsTotal) * 100),
            }))
            .sort((a, b) => b.value - a.value),
          gateways: Object.entries(gatewayAgg)
            .map(([name, value]) => ({
              name,
              value,
              pct: Math.round((value / gatewaysTotal) * 100),
            }))
            .sort((a, b) => b.value - a.value),
          latestSales,
          productStats: { lowStock, topSellers },
        },
      });
    } catch (err) {
      console.error('[AdminStats.overview]', err);
      return res.status(500).json({ error: 'Erro ao carregar métricas' });
    }
  }
}

module.exports = new AdminStatsController();
