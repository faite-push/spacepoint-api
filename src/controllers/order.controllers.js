const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');
const { resolveSellable } = require('../utils/productStore');
const { validateCouponForOrder, recordCouponUsage } = require('../services/coupon.service');
const {
  ORDER_PAYMENT_TTL_MS,
  reserveStockForOrderItem,
  fulfillPaidOrder,
  cancelOrder,
} = require('../services/orderFulfillment.service');
const {
  getCheckoutPaymentOptions,
  getOrCreateCheckoutPayment,
  syncPendingOrderPayment,
} = require('../services/payment.service');

class OrderController {
  async paymentOptions(req, res) {
    try {
      const options = await getCheckoutPaymentOptions();
      return res.json(options);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Falha ao carregar formas de pagamento' });
    }
  }

  async create(req, res) {
    try {
      const userId = req.user.id;
      const idempotencyKey =
        sanitizeString(req.headers['idempotency-key'] || req.body.idempotencyKey || '', 120) ||
        null;
      const items = Array.isArray(req.body.items) ? req.body.items : [];
      const couponCode = sanitizeString(req.body.couponCode || '', 64) || null;
      const paymentMethod = String(req.body.paymentMethod || 'PIX').trim().toUpperCase();

      if (!items.length || items.length > 20) {
        return res.status(400).json({ error: 'Carrinho inválido' });
      }

      const normalizedItems = items
        .map((item) => ({
          productId: sanitizeString(item.productId, 80),
          variantId: item.variantId ? sanitizeString(item.variantId, 80) : null,
          quantity: Math.max(1, Math.min(10, Number(item.quantity || 1))),
        }))
        .filter((item) => item.productId);

      if (!normalizedItems.length) {
        return res.status(400).json({ error: 'Produtos inválidos' });
      }

      const order = await prisma.$transaction(async (tx) => {
        if (idempotencyKey) {
          const existing = await tx.order.findUnique({
            where: { idempotencyKey },
            include: { items: true, couponUsage: true },
          });
          if (existing && existing.userId === userId) return existing;
        }

        const sellables = [];
        const orderItemsData = [];

        for (const item of normalizedItems) {
          const sellable = await resolveSellable(
            tx,
            item.productId,
            item.variantId,
            item.quantity,
            userId
          );
          const { product, variant, unitPriceCents, variantName } = sellable;

          const minQ = variant?.minPurchaseQuantity ?? product.minPurchaseQuantity ?? 1;
          const maxQ = variant?.maxPurchaseQuantity ?? product.maxPurchaseQuantity;
          if (item.quantity < minQ) {
            throw new Error(`Quantidade mínima: ${minQ}`);
          }
          if (maxQ != null && item.quantity > maxQ) {
            throw new Error(`Quantidade máxima: ${maxQ}`);
          }

          sellables.push({ item, sellable });
          orderItemsData.push({
            productId: product.id,
            variantId: variant?.id ?? null,
            variantName,
            quantity: item.quantity,
            unitPrice: unitPriceCents,
          });
        }

        const subtotal = orderItemsData.reduce(
          (sum, row) => sum + row.unitPrice * row.quantity,
          0
        );

        const { discountCents, coupon } = await validateCouponForOrder(tx, {
          code: couponCode,
          userId,
          orderItems: orderItemsData,
          subtotalCents: subtotal,
          paymentMethod,
        });

        const total = Math.max(0, subtotal - discountCents);
        const paymentExpiresAt = new Date(Date.now() + ORDER_PAYMENT_TTL_MS);

        const created = await tx.order.create({
          data: {
            userId,
            subtotal,
            discount: discountCents,
            total,
            idempotencyKey,
            paymentExpiresAt,
            items: { create: orderItemsData },
          },
          include: { items: true },
        });

        for (const { item, sellable } of sellables) {
          const orderItem = created.items.find(
            (oi) =>
              oi.productId === item.productId &&
              (oi.variantId ?? null) === (item.variantId ?? null)
          );
          if (!orderItem) throw new Error('Falha ao reservar estoque (itens do pedido divergentes)');
          await reserveStockForOrderItem(tx, item, orderItem.id, sellable);
        }

        if (coupon) {
          await recordCouponUsage(tx, {
            coupon,
            userId,
            orderId: created.id,
            discountCents,
          });
        }

        return created;
      });

      return res.status(201).json({ order });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Falha ao criar pedido' });
    }
  }

  async listMine(req, res) {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: {
            product: {
              select: {
                name: true,
                slug: true,
                platform: true,
                images: true,
                imageUrl: true,
              },
            },
            variant: { select: { id: true, name: true, sku: true } },
            codes: { select: { code: true, deliveredAt: true } },
          },
        },
      },
    });

    return res.json({ orders });
  }

  async getOneForCustomer(req, res) {
    try {
      const { id } = req.params;
      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          user: { select: { email: true, name: true } },
          items: {
            include: {
              product: { select: { name: true, imageUrl: true, slug: true, price: true } },
            },
          },
        },
      });

      if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

      if (order.userId !== req.user.id) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      let paymentData = null;
      if (order.status === 'PENDING') {
        if (order.paymentExpiresAt && new Date(order.paymentExpiresAt) < new Date()) {
          await prisma.$transaction((tx) => cancelOrder(tx, order.id, 'Expirado por falta de pagamento'));
          order.status = 'CANCELLED';
        } else {
          await syncPendingOrderPayment(order.id);

          const refreshed = await prisma.order.findUnique({
            where: { id },
            include: {
              user: { select: { email: true, name: true } },
              items: {
                include: {
                  product: { select: { name: true, imageUrl: true, slug: true, price: true } },
                },
              },
            },
          });
          if (refreshed) Object.assign(order, refreshed);

          if (order.status === 'PENDING') {
            const paymentMethod = String(req.query.paymentMethod || 'PIX').trim().toUpperCase();
            paymentData = await getOrCreateCheckoutPayment(order, paymentMethod);
          }
        }
      }

      return res.json({ order, paymentData });
    } catch (err) {
      console.error('[OrderController.getOneForCustomer]', err);
      return res.status(400).json({ error: err.message || 'Erro ao buscar pedido' });
    }
  }

  async markPaidAndDeliver(req, res) {
    try {
      const orderId = sanitizeString(req.params.id, 80);

      const order = await prisma.$transaction(async (tx) =>
        fulfillPaidOrder(tx, orderId, {
          provider: 'manual-admin',
          description: 'Pagamento aprovado manualmente',
        })
      );

      return res.json({ order });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Falha ao entregar pedido' });
    }
  }

  async listAll(req, res) {
    try {
      const { search, status, from, to, page = 1 } = req.query;
      const pageSize = 20;
      const skip = (Number(page) - 1) * pageSize;

      const where = {};
      if (status && status !== 'ALL') where.status = status;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lte = new Date(to);
      }
      if (search) {
        where.OR = [
          { id: { contains: search, mode: 'insensitive' } },
          { user: { name: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [orders, total, stats] = await Promise.all([
        prisma.order.findMany({
          where,
          include: {
            user: { select: { name: true, email: true } },
            _count: { select: { items: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }),
        prisma.order.count({ where }),
        prisma.order.aggregate({
          where,
          _sum: { total: true },
          _avg: { total: true },
        }),
      ]);

      const paidCount = await prisma.order.count({
        where: { ...where, status: { in: ['PAID', 'DELIVERED'] } },
      });

      const formattedOrders = orders.map((o) => ({
        id: o.id,
        status: o.status,
        subtotal: o.subtotal,
        discount: o.discount,
        total: o.total,
        customerName: o.user?.name || 'Cliente',
        customerEmail: o.user?.email || 'N/A',
        paymentMethod: o.idempotencyKey ? 'Online' : 'Manual',
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        itemsCount: o._count.items,
      }));

      return res.json({
        orders: formattedOrders,
        summary: {
          totalRevenue: stats._sum.total || 0,
          totalOrders: total,
          avgTicket: Math.round(stats._avg.total || 0),
          paidPct: total > 0 ? Math.round((paidCount / total) * 100) : 0,
        },
        pagination: {
          page: Number(page),
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (err) {
      console.error('[OrderController.listAll]', err);
      return res.status(500).json({ error: 'Erro ao listar pedidos' });
    }
  }

  async getOne(req, res) {
    try {
      const { id } = req.params;
      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          user: { select: { name: true, email: true, image: true } },
          items: {
            include: {
              product: { select: { name: true, imageUrl: true } },
              codes: { select: { code: true, deliveredAt: true } },
            },
          },
        },
      });

      if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

      return res.json({
        id: order.id,
        status: order.status,
        subtotal: order.subtotal,
        discount: order.discount,
        total: order.total,
        customerName: order.user?.name || 'Cliente',
        customerEmail: order.user?.email || 'N/A',
        customerImage: order.user?.image,
        paymentMethod: order.idempotencyKey ? 'Online' : 'Manual',
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        adminNotes: order.adminNotes,
        items: order.items.map((it) => ({
          id: it.id,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          variantName: it.variantName,
          product: it.product,
          codes: it.codes,
        })),
      });
    } catch (err) {
      console.error('[OrderController.getOne]', err);
      return res.status(500).json({ error: 'Erro ao buscar pedido' });
    }
  }

  async updateNotes(req, res) {
    try {
      const { id } = req.params;
      const { adminNotes } = req.body;

      const order = await prisma.order.update({
        where: { id },
        data: { adminNotes },
      });

      return res.json(order);
    } catch (err) {
      console.error('[OrderController.updateNotes]', err);
      return res.status(400).json({ error: 'Erro ao atualizar notas' });
    }
  }

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const allowed = ['PENDING', 'PAID', 'DELIVERED', 'CANCELLED'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: 'Status inválido' });
      }

      const order = await prisma.$transaction(async (tx) => {
        if (status === 'PAID') {
          return fulfillPaidOrder(tx, id, {
            provider: 'manual-admin',
            description: 'Pagamento aprovado via admin',
          });
        }

        if (status === 'CANCELLED') {
          return cancelOrder(tx, id, 'Cancelado pelo administrador');
        }

        return tx.order.update({
          where: { id },
          data: { status },
        });
      });

      return res.json(order);
    } catch (err) {
      console.error('[OrderController.updateStatus]', err);
      return res.status(400).json({ error: err.message || 'Erro ao atualizar pedido' });
    }
  }

  async bulkUpdateStatus(req, res) {
    try {
      const { ids, status } = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ error: 'IDs inválidos' });

      const allowed = ['PENDING', 'PAID', 'DELIVERED', 'CANCELLED'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: 'Status inválido' });
      }

      await prisma.$transaction(async (tx) => {
        for (const id of ids) {
          if (status === 'PAID') {
            await fulfillPaidOrder(tx, id, {
              provider: 'manual-admin',
              description: 'Pagamento aprovado via admin (Bulk)',
            });
          } else if (status === 'CANCELLED') {
            await cancelOrder(tx, id, 'Cancelado em massa pelo administrador');
          } else {
            await tx.order.update({ where: { id }, data: { status } });
          }
        }
      });

      return res.json({ success: true });
    } catch (err) {
      console.error('[OrderController.bulkUpdateStatus]', err);
      return res.status(400).json({ error: err.message || 'Erro ao atualizar pedidos em massa' });
    }
  }
}

module.exports = new OrderController();
