const { prisma } = require('../config/prisma');
const { resolveSellable } = require('../utils/productStore');
const { syncAutomaticStockFromCodes } = require('../utils/digitalStock');
const { initializeChatForPaidOrder } = require('./chat.service');
const orderEmailService = require('./orderEmail.service');
const { finalizeOrderDelivery, emitDeliverySideEffects } = require('./orderDelivery.service');

const ORDER_PAYMENT_TTL_MS = 30 * 60 * 1000;

/**
 * Reserva códigos AVAILABLE de forma atômica (updateMany com condição de status).
 * Evita que dois pedidos concorrentes reservem o mesmo código.
 */
async function reserveAvailableCodes(tx, { productId, variantId, quantity, orderItemId, excludeIds = [] }) {
  const reservedIds = [];
  let attempts = 0;
  const maxAttempts = Math.max(quantity * 8, 16);

  while (reservedIds.length < quantity && attempts < maxAttempts) {
    attempts += 1;

    const candidate = await tx.productCode.findFirst({
      where: {
        status: 'AVAILABLE',
        productId,
        variantId: variantId ?? null,
        ...(reservedIds.length || excludeIds.length
          ? { id: { notIn: [...reservedIds, ...excludeIds] } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!candidate) break;

    const updated = await tx.productCode.updateMany({
      where: { id: candidate.id, status: 'AVAILABLE' },
      data: { status: 'RESERVED', orderItemId },
    });

    if (updated.count === 1) {
      reservedIds.push(candidate.id);
    }
  }

  if (reservedIds.length < quantity) {
    throw new Error('Estoque insuficiente para reserva');
  }

  return reservedIds;
}

/**
 * Entrega códigos AVAILABLE de forma atômica (marca DELIVERED).
 */
async function deliverAvailableCodes(tx, { productId, variantId, quantity, orderItemId, excludeIds = [] }) {
  const deliveredIds = [];
  let attempts = 0;
  const maxAttempts = Math.max(quantity * 8, 16);
  const now = new Date();

  while (deliveredIds.length < quantity && attempts < maxAttempts) {
    attempts += 1;

    const candidate = await tx.productCode.findFirst({
      where: {
        status: 'AVAILABLE',
        productId,
        variantId: variantId ?? null,
        ...(deliveredIds.length || excludeIds.length
          ? { id: { notIn: [...deliveredIds, ...excludeIds] } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!candidate) break;

    const updated = await tx.productCode.updateMany({
      where: { id: candidate.id, status: 'AVAILABLE' },
      data: {
        status: 'DELIVERED',
        deliveredAt: now,
        orderItemId,
        variantId: variantId ?? undefined,
      },
    });

    if (updated.count === 1) {
      deliveredIds.push(candidate.id);
    }
  }

  if (deliveredIds.length < quantity) {
    throw new Error('Estoque insuficiente de códigos digitais');
  }

  return deliveredIds;
}

async function getSellableForItem(tx, item) {
  return resolveSellable(tx, item.productId, item.variantId, item.quantity);
}

async function reserveStockForOrderItem(tx, item, orderItemId, sellable) {
  const entity = sellable.variant || sellable.product;
  const deliveryType = entity.deliveryType;
  let stockReserved = 0;

  if (deliveryType === 'automatic_lines' || deliveryType === 'mixed') {
    await reserveAvailableCodes(tx, {
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
      orderItemId,
    });
    await syncAutomaticStockFromCodes(tx, item.productId, item.variantId ?? null);
  } else {
    const manualStock = entity.stockQuantity;
    if (manualStock != null) {
      if (manualStock <= 0) {
        throw new Error('Estoque insuficiente para reserva');
      }
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
  if (deliveryType !== 'automatic_lines' && deliveryType !== 'mixed') return;

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

  const reservedIds = reserved.map((c) => c.id);
  const stillNeeded = item.quantity - reserved.length;

  if (stillNeeded > 0) {
    await deliverAvailableCodes(tx, {
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: stillNeeded,
      orderItemId: item.id,
      excludeIds: reservedIds,
    });
  }

  for (const code of reserved) {
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
}

/**
 * Reverte estoque ao reembolsar: reservados voltam, entregues são invalidados.
 */
async function reverseOrderInventoryOnRefund(tx, orderId) {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    include: { codes: { select: { id: true, code: true, status: true } } },
  });

  for (const item of items) {
    await tx.productCode.updateMany({
      where: { orderItemId: item.id, status: 'RESERVED' },
      data: { status: 'AVAILABLE', orderItemId: null },
    });

    const deliveredCodes = item.codes.filter((c) => c.status === 'DELIVERED');
    for (const code of deliveredCodes) {
      await tx.productCode.update({
        where: { id: code.id },
        data: { status: 'REFUNDED' },
      });

      if (item.variantId) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { digitalLines: true },
        });
        if (variant?.digitalLines?.includes(code.code)) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { digitalLines: variant.digitalLines.filter((line) => line !== code.code) },
          });
        }
      } else {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { digitalLines: true },
        });
        if (product?.digitalLines?.includes(code.code)) {
          await tx.product.update({
            where: { id: item.productId },
            data: { digitalLines: product.digitalLines.filter((line) => line !== code.code) },
          });
        }
      }
    }

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

    if (deliveryType === 'automatic_lines' || deliveryType === 'mixed') {
      await syncAutomaticStockFromCodes(tx, item.productId, item.variantId ?? null);
    } else {
      const undeliveredQty = Math.max(0, item.quantity - deliveredCodes.length);
      if (undeliveredQty > 0) {
        if (item.variantId) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stockQuantity: { increment: undeliveredQty } },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQuantity: { increment: undeliveredQty } },
          });
        }
      }
    }

    await tx.orderItem.update({
      where: { id: item.id },
      data: { stockReserved: 0 },
    });
  }
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
    if (deliveryType === 'automatic_lines' || deliveryType === 'mixed') {
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
  // Serializa webhooks/verificações concorrentes no mesmo pedido
  await tx.$executeRaw`SELECT 1 FROM "Order" WHERE id = ${orderId} FOR UPDATE`;

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

  const deliveryResult = await finalizeOrderDelivery(tx, current.id);
  if (deliveryResult.changed) {
    updatedOrder._deliveryResult = deliveryResult;
  }

  return updatedOrder;
}

function notifyOrderChatCreated(order) {
  if (order?._deliveryResult) {
    emitDeliverySideEffects(order._deliveryResult);
  }

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
      orderEmailService.notifyOrderCancelled(id, {
        reason: 'Expirado por falta de pagamento',
        expired: true,
      });
    } catch (err) {
      console.error('[expireStalePendingOrders]', id, err.message);
    }
  }

  return stale.length;
}

/**
 * Reserva e entrega um único código digital de forma atômica (admin/chat).
 * Prioriza RESERVED do pedido; fallback para AVAILABLE.
 */
async function claimOneCodeForDelivery(tx, { orderItemId, productId, variantId }) {
  const now = new Date();

  const reserved = await tx.productCode.findFirst({
    where: { orderItemId, status: 'RESERVED' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true },
  });

  if (reserved) {
    const claimed = await tx.productCode.updateMany({
      where: { id: reserved.id, status: 'RESERVED' },
      data: { status: 'DELIVERED', deliveredAt: now, orderItemId },
    });
    if (claimed.count === 1) return reserved;
  }

  let attempts = 0;
  while (attempts < 8) {
    attempts += 1;

    const candidate = await tx.productCode.findFirst({
      where: {
        status: 'AVAILABLE',
        productId,
        variantId: variantId ?? null,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true },
    });

    if (!candidate) return null;

    const claimed = await tx.productCode.updateMany({
      where: { id: candidate.id, status: 'AVAILABLE' },
      data: { status: 'DELIVERED', deliveredAt: now, orderItemId },
    });

    if (claimed.count === 1) return candidate;
  }

  return null;
}

module.exports = {
  ORDER_PAYMENT_TTL_MS,
  reserveStockForOrderItem,
  releaseOrderStock,
  reverseOrderInventoryOnRefund,
  deliverOrderItem,
  claimOneCodeForDelivery,
  fulfillPaidOrder,
  cancelOrder,
  notifyOrderChatCreated,
  emitDeliverySideEffects,
  expireStalePendingOrders,
};
