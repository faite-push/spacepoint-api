const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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
      const today = startOfDayUTC();
      const tomorrow = addDays(today, 1);
      const yesterday = addDays(today, -1);

      const last7Start = addDays(today, -6); // inclui hoje (7 dias)
      const previous7Start = addDays(today, -13);

      const last30Start = addDays(today, -30);
      const previous30Start = addDays(today, -60);

      // ─── Receita ────────────────────────────────────────────────────────
      const [revenueLast7, revenuePrev7] = await Promise.all([
        prisma.payment.aggregate({
          _sum: { amount: true },
          where: { status: 'PAID', createdAt: { gte: last7Start, lt: tomorrow } },
        }),
        prisma.payment.aggregate({
          _sum: { amount: true },
          where: { status: 'PAID', createdAt: { gte: previous7Start, lt: last7Start } },
        }),
      ]);

      const revenueCurrent = revenueLast7._sum.amount ?? 0;
      const revenuePrevious = revenuePrev7._sum.amount ?? 0;

      // ─── Pedidos hoje ───────────────────────────────────────────────────
      const [ordersToday, ordersYesterday] = await Promise.all([
        prisma.order.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
        prisma.order.count({ where: { createdAt: { gte: yesterday, lt: today } } }),
      ]);

      // ─── Produtos ativos ────────────────────────────────────────────────
      const [productsActive, productsActive30dAgo] = await Promise.all([
        prisma.product.count({ where: { isVisible: true, isActive: true } }),
        prisma.product.count({
          where: {
            isVisible: true,
            isActive: true,
            createdAt: { lt: last30Start },
          },
        }),
      ]);

      // ─── Usuários ───────────────────────────────────────────────────────
      const [usersTotal, usersBefore30d] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { lt: last30Start } } }),
      ]);

      // ─── Gráfico de vendas (últimos 7 dias) ─────────────────────────────
      // Busca todos os pagamentos PAID do período em uma única query
      // e agrupa em buckets diários no Node (evita complexidade SQL).
      const paidPayments7d = await prisma.payment.findMany({
        where: { status: 'PAID', createdAt: { gte: last7Start, lt: tomorrow } },
        select: { amount: true, createdAt: true },
      });

      const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const buckets = [];
      for (let i = 6; i >= 0; i--) {
        const dayStart = addDays(today, -i);
        const key = dayStart.toISOString().slice(0, 10);
        buckets.push({
          key,
          day: dayLabels[dayStart.getUTCDay()],
          sales: 0,
          revenue: 0,
        });
      }
      const bucketByKey = new Map(buckets.map((b) => [b.key, b]));
      for (const p of paidPayments7d) {
        const k = p.createdAt.toISOString().slice(0, 10);
        const b = bucketByKey.get(k);
        if (b) {
          b.sales += 1;
          b.revenue += p.amount;
        }
      }

      // ─── Top produtos ───────────────────────────────────────────────────
      const topAgg = await prisma.orderItem.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
        where: { order: { status: { in: ['PAID', 'DELIVERED'] } } },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      });

      const topProducts = await Promise.all(
        topAgg.map(async (row) => {
          const product = await prisma.product.findUnique({
            where: { id: row.productId },
            select: { id: true, name: true, slug: true, imageUrl: true },
          });
          // Receita por produto = SUM(quantity * unitPrice)
          const items = await prisma.orderItem.findMany({
            where: {
              productId: row.productId,
              order: { status: { in: ['PAID', 'DELIVERED'] } },
            },
            select: { quantity: true, unitPrice: true },
          });
          const revenue = items.reduce(
            (sum, it) => sum + it.quantity * it.unitPrice,
            0
          );
          return {
            id: product?.id ?? row.productId,
            name: product?.name ?? '—',
            slug: product?.slug ?? null,
            imageUrl: product?.imageUrl ?? null,
            sales: row._sum.quantity ?? 0,
            revenue,
          };
        })
      );

      // ─── Últimos pedidos ────────────────────────────────────────────────
      const recentOrders = await prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          items: {
            take: 1,
            include: {
              product: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });

      const recentOrdersDto = recentOrders.map((o) => ({
        id: o.id,
        status: o.status,
        total: o.total,
        createdAt: o.createdAt,
        customer: {
          name: o.user?.name || o.user?.email?.split('@')[0] || 'Cliente',
          email: o.user?.email ?? null,
        },
        product: o.items[0]?.product?.name ?? '—',
        itemsCount: o.items.length,
      }));

      // ─── Resposta ───────────────────────────────────────────────────────
      return res.json({
        metrics: {
          revenue: {
            value: revenueCurrent,
            change: pctChange(revenueCurrent, revenuePrevious),
            previousValue: revenuePrevious,
          },
          ordersToday: {
            value: ordersToday,
            change: pctChange(ordersToday, ordersYesterday),
            previousValue: ordersYesterday,
          },
          activeProducts: {
            value: productsActive,
            change: pctChange(productsActive, productsActive30dAgo),
            previousValue: productsActive30dAgo,
          },
          users: {
            value: usersTotal,
            change: pctChange(usersTotal, usersBefore30d),
            previousValue: usersBefore30d,
          },
        },
        salesChart: buckets.map(({ day, sales, revenue }) => ({ day, sales, revenue })),
        topProducts,
        recentOrders: recentOrdersDto,
      });
    } catch (err) {
      console.error('[AdminStats.overview]', err);
      return res.status(500).json({ error: 'Erro ao carregar métricas' });
    }
  }
}

module.exports = new AdminStatsController();
