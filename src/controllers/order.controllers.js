const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');
const { resolveSellable } = require('../utils/productStore');

class OrderController {
  async create(req, res) {
    try {
      const userId = req.user.id;
      const idempotencyKey =
        sanitizeString(req.headers['idempotency-key'] || req.body.idempotencyKey || '', 120) ||
        null;
      const items = Array.isArray(req.body.items) ? req.body.items : [];

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
            include: { items: true },
          });
          if (existing && existing.userId === userId) return existing;
        }

        const orderItems = [];
        for (const item of normalizedItems) {
          const sellable = await resolveSellable(tx, item.productId, item.variantId);
          const { product, variant, unitPriceCents, variantName } = sellable;

          const minQ = variant?.minPurchaseQuantity ?? product.minPurchaseQuantity ?? 1;
          const maxQ = variant?.maxPurchaseQuantity ?? product.maxPurchaseQuantity;
          if (item.quantity < minQ) {
            throw new Error(`Quantidade mínima: ${minQ}`);
          }
          if (maxQ != null && item.quantity > maxQ) {
            throw new Error(`Quantidade máxima: ${maxQ}`);
          }

          orderItems.push({
            productId: product.id,
            variantId: variant?.id ?? null,
            variantName,
            quantity: item.quantity,
            unitPrice: unitPriceCents,
          });
        }

        const total = orderItems.reduce(
          (sum, row) => sum + row.unitPrice * row.quantity,
          0
        );

        return tx.order.create({
          data: {
            userId,
            total,
            idempotencyKey,
            items: { create: orderItems },
          },
          include: { items: true },
        });
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

  async markPaidAndDeliver(req, res) {
    try {
      const orderId = sanitizeString(req.params.id, 80);

      const order = await prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({
          where: { id: orderId },
          include: { items: true },
        });
        if (!current) throw new Error('Pedido não encontrado');
        if (current.status === 'PAID') return current;

        for (const item of current.items) {
          const codeWhere = {
            status: 'AVAILABLE',
            productId: item.productId,
            ...(item.variantId
              ? { OR: [{ variantId: item.variantId }, { variantId: null }] }
              : { variantId: null }),
          };

          const availableCodes = await tx.productCode.findMany({
            where: codeWhere,
            take: item.quantity,
            orderBy: [{ variantId: 'desc' }, { createdAt: 'asc' }],
          });

          if (availableCodes.length < item.quantity) {
            throw new Error('Estoque insuficiente de códigos digitais');
          }

          for (const code of availableCodes) {
            await tx.productCode.update({
              where: { id: code.id },
              data: {
                status: 'DELIVERED',
                deliveredAt: new Date(),
                orderItemId: item.id,
                variantId: item.variantId || code.variantId,
              },
            });
          }
        }

        await tx.payment.create({
          data: {
            userId: current.userId,
            orderId: current.id,
            amount: current.total,
            status: 'PAID',
            provider: 'manual-admin',
            description: 'Pagamento aprovado manualmente',
          },
        });

        return tx.order.update({
          where: { id: current.id },
          data: { status: 'PAID', paidAt: new Date() },
          include: {
            items: { include: { codes: true, variant: true } },
          },
        });
      });

      return res.json({ order });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Falha ao entregar pedido' });
    }
  }
}

module.exports = new OrderController();
