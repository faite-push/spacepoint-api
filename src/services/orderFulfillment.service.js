const { prisma } = require('../config/prisma');
const { resolveSellable } = require('../utils/productStore');
const { syncAutomaticStockFromCodes } = require('../utils/digitalStock');
const { initializeChatForPaidOrder } = require('./chat.service');

const ORDER_PAYMENT_TTL_MS = 30 * 60 * 1000;

async function getSellableForItem(tx, item) {
  return resolveSellable(tx, item.productId, item.variantId, item.quantity);
}

async function reserveStockForOrderItem(tx, item, orderItemId, sellable) {
  const entity = sellable.variant || sellable.product;
  const deliveryType = entity.deliveryType;
  let stockReserved = 0;

  if (deliveryType === 'automatic_lines') {
    const codes = await tx.productCode.findMany({
      where: {
        status: 'AVAILABLE',
        productId: item.productId,
        variantId: item.variantId ?? null,
      },
      take: item.quantity,
      orderBy: [{ createdAt: 'asc' }],
    });

    if (codes.length < item.quantity) {
      throw new Error('Estoque insuficiente para reserva');
    }

    for (const code of codes) {
      await tx.productCode.update({
        where: { id: code.id },
        data: { status: 'RESERVED', orderItemId },
      });
    }
    await syncAutomaticStockFromCodes(tx, item.productId, item.variantId ?? null);
  } else {
    const manualStock = entity.stockQuantity ?? 0;
    if (manualStock > 0) {
      if (sellable.variant) {
        const updated = await tx.productVariant.updateMany({
          where: {
            id: sellable.variant.id,
            stockQuantity: { gte: item.quantity },
          },
          data: { stockQuantity: { decrement: item.quantity } },
        });
        if (updated.count === 0) throw new Error('Estoque insuficiente para reserva');
      } else {
        const updated = await tx.product.updateMany({
          where: {
            id: sellable.product.id,
            stockQuantity: { gte: item.quantity },
          },
          data: { stockQuantity: { decrement: item.quantity } },
        });
        if (updated.count === 0) throw new Error('Estoque insuficiente para reserva');
      }
      stockReserved = item.quantity;
    }
  }

  if (stockReserved > 0) {
    await tx.orderItem.update({
      where: { id: orderItemId },
      data: { stockReserved },
    });
  }
}

async function deliverOrderItem(tx, item) {
  const sellable = await getSellableForItem(tx, item);
  const deliveryType = sellable.variant?.deliveryType ?? sellable.product.deliveryType;
  if (deliveryType !== 'automatic_lines') return;

  const reserved = await tx.productCode.findMany({
    where: { orderItemId: item.id, status: 'RESERVED' },
    orderBy: { createdAt: 'asc' },
  });

  if (reserved.length >= item.quantity) {
    for (const code of reserved.slice(0, item.quantity)) {
      await tx.productCode.update({
        where: { id: code.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          variantId: item.variantId || code.variantId,
        },
      });
    }
    await syncAutomaticStockFromCodes(tx, item.productId, item.variantId ?? null);
    return;
  }

  const codeWhere = {
    status: 'AVAILABLE',
    productId: item.productId,
    ...(item.variantId ? { variantId: item.variantId } : { variantId: null }),
  };

  const availableCodes = await tx.productCode.findMany({
    where: codeWhere,
    take: item.quantity - reserved.length,
    orderBy: [{ createdAt: 'asc' }],
  });

  const allCodes = [...reserved, ...availableCodes];
  if (allCodes.length < item.quantity) {
    throw new Error('Estoque insuficiente de códigos digitais');
  }

  for (const code of allCodes) {
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
  await syncAutomaticStockFromCodes(tx, item.productId, item.variantId ?? null);
}

async function releaseOrderStock(tx, orderId) {
  const items = await tx.orderItem.findMany({ where: { orderId } });

  for (const item of items) {
    await tx.productCode.updateMany({
      where: { orderItemId: item.id, status: 'RESERVED' },
      data: { status: 'AVAILABLE', orderItemId: null },
    });

    const variant = item.variantId
      ? await tx.productVariant.findUnique({
        where: { id: item.variantId },
        select: { deliveryType: true },
      })
      : null;
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { deliveryType: true },
    });
    const deliveryType = variant?.deliveryType ?? product?.deliveryType;
    if (deliveryType === 'automatic_lines') {
      await syncAutomaticStockFromCodes(tx, item.productId, item.variantId ?? null);
    }

    if (item.stockReserved > 0) {
      if (item.variantId) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stockQuantity: { increment: item.stockReserved } },
        });
      } else {
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: { increment: item.stockReserved } },
        });
      }
      await tx.orderItem.update({
        where: { id: item.id },
        data: { stockReserved: 0 },
      });
    }
  }
}

/**
 * Marca pedido como pago, entrega itens digitais e registra pagamento.
 */
async function fulfillPaidOrder(tx, orderId, paymentMeta = {}) {
  const current = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true, payments: true },
  });

  if (!current) throw new Error('Pedido não encontrado');
  if (['PAID', 'DELIVERED'].includes(current.status)) {
    return tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { codes: true, variant: true } } },
    });
  }

  if (current.status === 'CANCELLED') {
    throw new Error('Pedido cancelado não pode ser pago');
  }

  for (const item of current.items) {
    await deliverOrderItem(tx, item);
  }

  const provider = paymentMeta.provider || 'manual-admin';
  const externalId = paymentMeta.externalId || null;
  const description = paymentMeta.description || 'Pagamento aprovado';

  const hasPaidRecord = current.payments.some((p) => p.status === 'PAID');
  if (!hasPaidRecord && !paymentMeta.skipPaymentCreate) {
    if (externalId) {
      const existing = await tx.payment.findUnique({ where: { externalId } });
      if (existing) {
        await tx.payment.update({
          where: { id: existing.id },
          data: { status: 'PAID', amount: current.total },
        });
      } else {
        await tx.payment.create({
          data: {
            userId: current.userId,
            orderId: current.id,
            amount: current.total,
            status: 'PAID',
            provider,
            externalId,
            description,
          },
        });
      }
    } else {
      await tx.payment.create({
        data: {
          userId: current.userId,
          orderId: current.id,
          amount: current.total,
          status: 'PAID',
          provider,
          description,
        },
      });
    }
  }

  await tx.payment.updateMany({
    where: { orderId: current.id, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });

  const updatedOrder = await tx.order.update({
    where: { id: current.id },
    data: { status: 'PAID', paidAt: new Date() },
    include: { items: { include: { codes: true, variant: true } } },
  });

  try {
    const chat = await initializeChatForPaidOrder(tx, current.id);
    if (chat?.id) {
      updatedOrder._wsChatId = chat.id;
      updatedOrder._wsUserId = current.userId;
    }
  } catch (err) {
    console.error('[fulfillPaidOrder] Failed to initialize chat', err);
  }

  return updatedOrder;
}

function notifyOrderChatCreated(order) {
  if (!order?._wsChatId) return;

  setImmediate(async () => {
    try {
      const socketService = require('./websocket.service');
      const chat = await prisma.chat.findUnique({
        where: { id: order._wsChatId },
        include: {
          order: { include: { user: { select: { name: true, email: true } } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      if (!chat) return;

      const customerName = chat.order.user?.name || chat.order.user?.email || 'Cliente';
      socketService.notifyChatCreated(
        chat.id,
        order._wsUserId,
        chat.messages[0] || null,
        { orderId: chat.orderId, customerName }
      );
    } catch (err) {
      console.error('[notifyOrderChatCreated]', err.message);
    }
  });
}

async function cancelOrder(tx, orderId, reason = 'cancelled') {
  const current = await tx.order.findUnique({ where: { id: orderId } });
  if (!current) throw new Error('Pedido não encontrado');
  if (['PAID', 'DELIVERED'].includes(current.status)) {
    throw new Error('Pedido pago não pode ser cancelado');
  }

  await releaseOrderStock(tx, orderId);
  await tx.payment.updateMany({
    where: { orderId, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });

  return tx.order.update({
    where: { id: orderId },
    data: { status: 'CANCELLED', adminNotes: reason },
  });
}

async function expireStalePendingOrders() {
  const cutoff = new Date(Date.now() - ORDER_PAYMENT_TTL_MS);
  const stale = await prisma.order.findMany({
    where: {
      status: 'PENDING',
      OR: [
        { paymentExpiresAt: { lt: new Date() } },
        { paymentExpiresAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
    take: 50,
  });

  for (const { id } of stale) {
    try {
      await prisma.$transaction((tx) => cancelOrder(tx, id, 'Expirado por falta de pagamento'));
    } catch (err) {
      console.error('[expireStalePendingOrders]', id, err.message);
    }
  }

  return stale.length;
}

module.exports = {
  ORDER_PAYMENT_TTL_MS,
  reserveStockForOrderItem,
  releaseOrderStock,
  deliverOrderItem,
  fulfillPaidOrder,
  cancelOrder,
  notifyOrderChatCreated,
  expireStalePendingOrders,
};
