const { prisma } = require('../config/prisma');
const {
  countUniqueVisitors,
  listVisitsInRange,
  listAllVisitsBefore,
} = require('../services/analytics.service');

/**
 * Helpers de datas.
 * Trabalhamos em UTC para evitar deslocamentos de timezone.
 */
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
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

class AdminStatsController {
  /**
   * GET /v2/api/admin/stats
   *
   * Retorna métricas agregadas para o dashboard admin:
   * - Receita total (PAID) com variação vs período anterior
   * - Pedidos hoje vs ontem
   * - Produtos ativos (com variação vs 30 dias atrás)
   * - Usuários totais (com variação vs 30 dias atrás)
   * - Vendas dos últimos 7 dias (gráfico)
   * - Top 5 produtos mais vendidos
   * - Últimos 5 pedidos
   */
  async overview(req, res) {
    try {
      const { from, to } = req.query;
      
      const dateEnd = to ? new Date(to) : addDays(startOfDayUTC(), 1);
      const dateStart = from ? new Date(from) : addDays(dateEnd, -7);
      
      const diffMs = dateEnd.getTime() - dateStart.getTime();
      const prevStart = new Date(dateStart.getTime() - diffMs);
      const prevEnd = dateStart;

      // ─── Metrics ────────────────────────────────────────────────────────
      const [
        revenueCurr, revenuePrev,
        ordersCurr, ordersPrev,
        usersCurr, usersPrev,
        paidOrdersCount, pendingOrdersCount,
        totalItemsSold,
        visitsCurr, visitsPrev,
      ] = await Promise.all([
        prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'PAID', createdAt: { gte: dateStart, lt: dateEnd } } }),
        prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'PAID', createdAt: { gte: prevStart, lt: prevEnd } } }),
        prisma.order.count({ where: { status: { in: ['PAID', 'DELIVERED'] }, createdAt: { gte: dateStart, lt: dateEnd } } }),
        prisma.order.count({ where: { status: { in: ['PAID', 'DELIVERED'] }, createdAt: { gte: prevStart, lt: prevEnd } } }),
        prisma.user.count({ where: { createdAt: { gte: dateStart, lt: dateEnd } } }),
        prisma.user.count({ where: { createdAt: { gte: prevStart, lt: prevEnd } } }),
        prisma.order.count({ where: { status: { in: ['PAID', 'DELIVERED'] }, createdAt: { gte: dateStart, lt: dateEnd } } }),
        prisma.order.count({ where: { status: 'PENDING', createdAt: { gte: dateStart, lt: dateEnd } } }),
        prisma.orderItem.aggregate({ _sum: { quantity: true }, where: { order: { status: { in: ['PAID', 'DELIVERED'] }, createdAt: { gte: dateStart, lt: dateEnd } } } }),
        countUniqueVisitors(dateStart, dateEnd),
        countUniqueVisitors(prevStart, prevEnd),
      ]);

      const revValue = revenueCurr._sum.amount ?? 0;
      const revPrevValue = revenuePrev._sum.amount ?? 0;
      const salesCount = ordersCurr;
      const salesPrevCount = ordersPrev;
      const ticketValue = salesCount > 0 ? Math.floor(revValue / salesCount) : 0;
      const ticketPrevValue = salesPrevCount > 0 ? Math.floor(revPrevValue / salesPrevCount) : 0;

      const visitsValue = visitsCurr;
      const visitsPrevValue = visitsPrev;

      // ─── Charts Data ───────────────────────────────────────────────────
      const [payments, ordersLocal, orderItems, visitsInRange] = await Promise.all([
        prisma.payment.findMany({ where: { status: 'PAID', createdAt: { gte: dateStart, lt: dateEnd } }, select: { amount: true, createdAt: true, userId: true, provider: true } }),
        prisma.order.findMany({ where: { status: { in: ['PAID', 'DELIVERED'] }, createdAt: { gte: dateStart, lt: dateEnd } }, select: { id: true, createdAt: true, userId: true } }),
        prisma.orderItem.findMany({ where: { order: { status: { in: ['PAID', 'DELIVERED'] }, createdAt: { gte: dateStart, lt: dateEnd } } }, select: { quantity: true, order: { select: { createdAt: true } } } }),
        listVisitsInRange(dateStart, dateEnd),
      ]);

      // Decide bucket granularity based on period length
      const diffDays = Math.ceil((dateEnd - dateStart) / (1000 * 60 * 60 * 24));
      const useWeeklyBuckets = diffDays > 60;

      // Build buckets
      const buckets = [];
      let current = new Date(dateStart);
      while (current < dateEnd) {
        const key = current.toISOString().slice(0, 10);
        buckets.push({
          key,
          date: current.toISOString(),
          label: useWeeklyBuckets
            ? current.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
            : current.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          revenue: 0,
          sales: 0,
          unitsSold: 0,
          uniqueCustomers: new Set(),
          returningCustomers: new Set(),
          uniqueVisitors: new Set(),
          returningVisitors: new Set(),
        });
        // Advance by 7 days for weekly, 1 day for daily
        if (useWeeklyBuckets) {
          current = addDays(current, 7);
        } else {
          current = addDays(current, 1);
        }
      }

      // Build a lookup: for weekly buckets, each day maps to the bucket it belongs to
      const getBucketKey = (dateObj) => {
        if (!useWeeklyBuckets) return dateObj.toISOString().slice(0, 10);
        // Find the matching weekly bucket (the last bucket whose key <= this date)
        const dayKey = dateObj.toISOString().slice(0, 10);
        let matched = null;
        for (const b of buckets) {
          if (b.key <= dayKey) matched = b.key;
          else break;
        }
        return matched;
      };

      const bucketMap = new Map(buckets.map(b => [b.key, b]));

      // Fill Revenue and Sales
      for (const p of payments) {
        const k = getBucketKey(p.createdAt);
        const b = bucketMap.get(k);
        if (b) {
          b.revenue += p.amount;
          b.uniqueCustomers.add(p.userId);
        }
      }
      for (const o of ordersLocal) {
        const k = getBucketKey(o.createdAt);
        const b = bucketMap.get(k);
        if (b) b.sales += 1;
      }
      for (const item of orderItems) {
        const k = getBucketKey(item.order.createdAt);
        const b = bucketMap.get(k);
        if (b) b.unitsSold += item.quantity;
      }

      const allVisitorFirstSeen = {};
      const allVisitsBeforeEnd = await listAllVisitsBefore(dateEnd);

      for (const visit of allVisitsBeforeEnd) {
        if (!allVisitorFirstSeen[visit.visitorId]) {
          allVisitorFirstSeen[visit.visitorId] = visit.createdAt;
        }
      }

      for (const visit of visitsInRange) {
        const k = getBucketKey(visit.createdAt);
        const b = bucketMap.get(k);
        if (!b) continue;

        b.uniqueVisitors.add(visit.visitorId);

        const bucketStart = new Date(b.date);
        const firstSeen = allVisitorFirstSeen[visit.visitorId];
        if (firstSeen && firstSeen < bucketStart) {
          b.returningVisitors.add(visit.visitorId);
        }
      }

      const priorOrders = await prisma.order.findMany({
        where: {
          status: { in: ['PAID', 'DELIVERED'] },
          createdAt: { lt: dateEnd },
        },
        select: { userId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      const firstOrderByUser = {};
      for (const order of priorOrders) {
        if (!order.userId || firstOrderByUser[order.userId]) continue;
        firstOrderByUser[order.userId] = order.createdAt;
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
        }
      }

      const finalChart = buckets.map(b => ({
        ...b,
        uniqueCustomers: b.uniqueCustomers.size,
        returningCustomers: b.returningCustomers.size,
        uniqueVisitors: b.uniqueVisitors.size,
        returningVisitors: b.returningVisitors.size,
        revenue: b.revenue / 100
      }));

      // ─── Sidebar Data ──────────────────────────────────────────────────
      const totalOrdersForConversion = paidOrdersCount + pendingOrdersCount;
      const approvedPct = totalOrdersForConversion > 0 ? Math.round((paidOrdersCount / totalOrdersForConversion) * 100) : 0;
      
      const methodsAgg = {};
      const gatewayAgg = {};
      payments.forEach(p => {
        const prov = p.provider || 'Outros';
        gatewayAgg[prov] = (gatewayAgg[prov] || 0) + p.amount;
        const method = p.provider === 'PIX' ? 'PIX' : 'Cartão';
        methodsAgg[method] = (methodsAgg[method] || 0) + p.amount;
      });

      // Fetch Real Sidebar Data
      const [latestOrders, rawLowStockProducts, rawLowStockVariants, topItemStats] = await Promise.all([
        prisma.order.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          where: { status: { in: ['PAID', 'DELIVERED', 'PENDING'] } },
          include: { user: { select: { name: true, email: true } } }
        }),
        prisma.product.findMany({
          where: { stockQuantity: { lte: 10 }, isActive: true },
          take: 5,
          select: { id: true, name: true, stockQuantity: true, price: true }
        }),
        prisma.productVariant.findMany({
          where: { stockQuantity: { lte: 10 }, isActive: true },
          take: 5,
          include: { product: { select: { name: true } } }
        }),
        prisma.orderItem.groupBy({
          by: ['productId'],
          _sum: { quantity: true },
          where: { order: { status: { in: ['PAID', 'DELIVERED'] } } },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 5
        })
      ]);

      // Process Latest Sales
      const latestSales = latestOrders.map(o => ({
        id: o.id,
        customer: o.user?.name || o.user?.email || 'Cliente',
        value: o.total,
        time: o.createdAt, // Frontend handles formatting
        status: o.status === 'PAID' || o.status === 'DELIVERED' ? 'success' : (o.status === 'PENDING' ? 'pending' : 'failed')
      }));

      // Process Low Stock (Merge products and variants)
      const lowStock = [
        ...rawLowStockProducts.map(p => ({
          id: p.id,
          name: p.name,
          stock: p.stockQuantity,
          price: Number(p.price) * 100
        })),
        ...rawLowStockVariants.map(v => ({
          id: v.id,
          name: `${v.product.name} - ${v.name}`,
          stock: v.stockQuantity,
          price: Number(v.price) * 100
        }))
      ].sort((a, b) => a.stock - b.stock).slice(0, 10);

      // Process Top Sellers
      const topProductIds = topItemStats.map(s => s.productId);
      const topProductsData = await prisma.product.findMany({
        where: { id: { in: topProductIds } },
        select: { id: true, name: true, price: true }
      });

      const topSellers = topItemStats.map(stat => {
        const p = topProductsData.find(x => x.id === stat.productId);
        return {
          id: stat.productId,
          name: p?.name || 'Produto Removido',
          salesCount: stat._sum.quantity,
          price: Number(p?.price || 0) * 100
        };
      });

      // ─── Response ──────────────────────────────────────────────────────
      return res.json({
        metrics: {
          revenue: { value: revValue, change: pctChange(revValue, revPrevValue) },
          sales: { value: salesCount, change: pctChange(salesCount, salesPrevCount) },
          avgTicket: { value: ticketValue, change: pctChange(ticketValue, ticketPrevValue) },
          visits: { value: visitsValue, change: pctChange(visitsValue, visitsPrevValue) },
        },
        charts: {
          performance: finalChart,
          customers: finalChart.map(f => ({
            label: f.label,
            unique: f.uniqueVisitors,
            returning: f.returningVisitors,
          })),
        },
        sidebar: {
          conversion: { total: revValue, approvedCount: paidOrdersCount, pendingCount: pendingOrdersCount, approvedPct },
          methods: Object.entries(methodsAgg).map(([name, value]) => ({ name, value })),
          gateways: Object.entries(gatewayAgg).map(([name, value]) => ({ name, value })),
          latestSales,
          productStats: {
            lowStock,
            topSellers
          }
        }
      });
    } catch (err) {
      console.error('[AdminStats.overview]', err);
      return res.status(500).json({ error: 'Erro ao carregar métricas' });
    }
  }
}

module.exports = new AdminStatsController();
