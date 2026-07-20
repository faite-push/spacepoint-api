const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');
const { resolveSellable } = require('../utils/productStore');
const { validateCouponForOrder, recordCouponUsage } = require('../services/coupon.service');
const {
  normalizeCheckoutSettings,
  validateCheckoutData,
  syncUserProfileFromCheckout,
} = require('../utils/checkoutConfig');
const { getRequiredFieldsForCheckout } = require('../config/gatewayCapabilities');
const {
  ORDER_PAYMENT_TTL_MS,
  reserveStockForOrderItem,
  fulfillPaidOrder,
  notifyOrderChatCreated,
  cancelOrder,
} = require('../services/orderFulfillment.service');
const { finalizeOrderDelivery, emitDeliverySideEffects } = require('../services/orderDelivery.service');
const orderEmailService = require('../services/orderEmail.service');
const { emitOrderPaidSideEffects } = require('../services/orderPaidSideEffects.service');
const {
  getCheckoutPaymentOptions,
  getOrCreateCheckoutPayment,
  syncPendingOrderPayment,
} = require('../services/payment.service');
const { processOrderRefund } = require('../services/refund.service');
const cartService = require('../services/cart.service');
const marketingAutomations = require('../services/marketingAutomations.service');

function buildItemsPreview(items, totalCount) {
  if (!items?.length) {
    return totalCount > 0 ? `${totalCount} item(ns)` : 'Sem itens';
  }

  const first = items[0];
  const name = first.variant?.name
    ? `${first.product.name} — ${first.variant.name}`
    : first.variantName || first.product?.name || 'Produto';
  const line = `${first.quantity}x ${name}`;
  if (totalCount > 1) return `${line} +${totalCount - 1}`;
  return line;
}

function formatPaymentProvider(provider) {
  if (!provider) return null;
  const map = {
    'efi-bank': 'Efi Bank',
    'efi-pix': 'Efi Bank',
    'mercado-pago': 'Mercado Pago',
    pagbank: 'PagBank',
    stripe: 'Stripe',
    'manual-admin': 'Manual',
  };
  return map[provider] || provider.replace(/-/g, ' ');
}

class OrderController {
  async paymentOptions(req, res) {
    try {
      const paymentMethod = String(req.query.paymentMethod || 'PIX').trim().toUpperCase();
      const options = await getCheckoutPaymentOptions(paymentMethod);
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
      const deliveryOption = String(req.body.deliveryOption || 'standard').trim().toLowerCase();
      const recoveryToken = sanitizeString(req.body.recoveryToken || '', 128) || null;
      const recoverySource = sanitizeString(req.body.recoverySource || '', 32) || null;

      if (!items.length || items.length > 20) {
        return res.status(400).json({ error: 'Carrinho inválido' });
      }

      const siteConfig = await prisma.siteConfig.findUnique({ where: { id: 'default' } });
      const checkoutSettings = normalizeCheckoutSettings(siteConfig?.checkoutSettings);
      const paymentOptions = await getCheckoutPaymentOptions(paymentMethod);
      const requiredFields = getRequiredFieldsForCheckout(
        paymentOptions.pixGateway,
        paymentOptions.cardGateway,
        paymentMethod
      );

      const checkoutErrors = validateCheckoutData(
        checkoutSettings,
        req.body.checkoutData,
        requiredFields
      );
      if (checkoutErrors.length) {
        return res.status(400).json({ error: checkoutErrors[0] });
      }

      const deliveryConfig = checkoutSettings.deliveryOptions || {};
      let deliveryFee = 0;
      if (deliveryOption === 'express') {
        if (!deliveryConfig.enabled) {
          return res.status(400).json({ error: 'Entrega expressa indisponível' });
        }
        deliveryFee = Math.max(0, Number(deliveryConfig.expressFeeCents) || 0);
      } else if (deliveryOption !== 'standard') {
        return res.status(400).json({ error: 'Opção de entrega inválida' });
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

        const total = Math.max(0, subtotal - discountCents + deliveryFee);
        const paymentExpiresAt = new Date(Date.now() + ORDER_PAYMENT_TTL_MS);
        const adminNotes =
          deliveryOption === 'express'
            ? '[ENTREGA EXPRESSA] Priorizar atendimento e entrega deste pedido.'
            : null;

        const recoveryAttribution = recoveryToken
          ? await marketingAutomations.resolveRecoveryAttribution({
              recoveryToken,
              recoverySource,
              tx,
            })
          : null;

        const created = await tx.order.create({
          data: {
            userId,
            subtotal,
            discount: discountCents,
            deliveryFee,
            deliveryOption,
            total,
            idempotencyKey,
            paymentExpiresAt,
            paymentMethod,
            couponCode,
            checkoutData: req.body.checkoutData || null,
            adminNotes,
            clientIp: req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || null,
            userAgent: sanitizeString(req.headers['user-agent'] || '', 512) || null,
            ...(recoveryAttribution
              ? {
                  recoveredFromCartId: recoveryAttribution.recoveredFromCartId,
                  recoverySource: recoveryAttribution.recoverySource,
                }
              : {}),
            items: { create: orderItemsData },
          },
          include: { items: true },
        });

        if (recoveryAttribution) {
          await tx.abandonedCart.update({
            where: { id: recoveryAttribution.recoveredFromCartId },
            data: {
              convertedAt: new Date(),
              recoveredAt: new Date(),
              convertedOrderId: created.id,
            },
          });
        }

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

        await syncUserProfileFromCheckout(tx, userId, req.body.checkoutData);

        return created;
      });

      orderEmailService.notifyOrderCreated(order.id);
      if (!recoveryToken) {
        cartService.markConverted({ userId }).catch(() => {});
      }

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
        chat: {
          select: {
            id: true,
            status: true,
            rating: true,
            reviewStatus: true,
          },
        },
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
            codes: {
              where: { status: 'DELIVERED' },
              select: { code: true, deliveredAt: true },
            },
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
          chat: {
            select: {
              id: true,
              status: true,
              rating: true,
              reviewStatus: true,
            },
          },
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
          orderEmailService.notifyOrderCancelled(order.id, {
            reason: 'Expirado por falta de pagamento',
            expired: true,
          });
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

      notifyOrderChatCreated(order);
      orderEmailService.notifyPaymentConfirmed(order.id);
      emitOrderPaidSideEffects(order.id);

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
            items: {
              take: 1,
              include: {
                product: { select: { name: true } },
                variant: { select: { name: true } },
              },
            },
            payments: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: { provider: true, status: true },
            },
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
        paymentMethod: o.paymentMethod || (o.idempotencyKey ? 'Online' : 'Manual'),
        paymentProvider: formatPaymentProvider(o.payments?.[0]?.provider),
        couponCode: o.couponCode,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        itemsCount: o._count.items,
        itemsPreview: buildItemsPreview(o.items, o._count.items),
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
          payments: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              status: true,
              provider: true,
              amount: true,
              externalId: true,
              createdAt: true,
            },
          },
          items: {
            include: {
              product: { select: { name: true, imageUrl: true } },
              codes: { select: { code: true, deliveredAt: true, status: true } },
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
        deliveryOption: order.deliveryOption,
        deliveryFee: order.deliveryFee,
        customerName: order.user?.name || 'Cliente',
        customerEmail: order.user?.email || 'N/A',
        customerImage: order.user?.image,
        paymentMethod: order.paymentMethod || (order.idempotencyKey ? 'Online' : 'Manual'),
        couponCode: order.couponCode,
        checkoutData: order.checkoutData,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        adminNotes: order.adminNotes,
        payments: order.payments,
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

        if (status === 'DELIVERED') {
          const current = await tx.order.findUnique({ where: { id }, include: { items: true } });
          if (!current) throw new Error('Pedido não encontrado');
          if (!['PAID', 'DELIVERED'].includes(current.status)) {
            await fulfillPaidOrder(tx, id, {
              provider: 'manual-admin',
              description: 'Pagamento aprovado via admin',
            });
          }
          const deliveryResult = await finalizeOrderDelivery(tx, id, { force: true });
          const updated = await tx.order.findUnique({ where: { id } });
          if (updated) updated._deliveryResult = deliveryResult;
          return updated;
        }

        return tx.order.update({
          where: { id },
          data: { status },
        });
      });

      if (status === 'PAID') {
        notifyOrderChatCreated(order);
        orderEmailService.notifyPaymentConfirmed(order.id);
        emitOrderPaidSideEffects(order.id);
      } else if (status === 'DELIVERED') {
        if (order?._deliveryResult) {
          await emitDeliverySideEffects(order._deliveryResult);
        } else {
          orderEmailService.notifyOrderDelivered(order.id);
        }
      } else if (status === 'CANCELLED') {
        orderEmailService.notifyOrderCancelled(order.id, {
          reason: 'Cancelado pelo administrador',
        });
      }

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

      const paidOrders = [];

      await prisma.$transaction(async (tx) => {
        for (const id of ids) {
          if (status === 'PAID') {
            const order = await fulfillPaidOrder(tx, id, {
              provider: 'manual-admin',
              description: 'Pagamento aprovado via admin (Bulk)',
            });
            paidOrders.push(order);
          } else if (status === 'CANCELLED') {
            await cancelOrder(tx, id, 'Cancelado em massa pelo administrador');
          } else {
            await tx.order.update({ where: { id }, data: { status } });
          }
        }
      });

      for (const order of paidOrders) {
        notifyOrderChatCreated(order);
        orderEmailService.notifyPaymentConfirmed(order.id);
        emitOrderPaidSideEffects(order.id);
      }

      if (status === 'CANCELLED') {
        for (const id of ids) {
          orderEmailService.notifyOrderCancelled(id, {
            reason: 'Cancelado em massa pelo administrador',
          });
        }
      }

      return res.json({ success: true });
    } catch (err) {
      console.error('[OrderController.bulkUpdateStatus]', err);
      return res.status(400).json({ error: err.message || 'Erro ao atualizar pedidos em massa' });
    }
  }

  async refund(req, res) {
    try {
      const { id } = req.params;
      const reason = sanitizeString(req.body?.reason || '', 500);
      const skipGateway = Boolean(req.body?.skipGateway);

      const result = await processOrderRefund(id, { reason, skipGateway, req });
      return res.json(result);
    } catch (err) {
      console.error('[OrderController.refund]', err);
      return res.status(400).json({ error: err.message || 'Erro ao processar reembolso' });
    }
  }
}

module.exports = new OrderController();
