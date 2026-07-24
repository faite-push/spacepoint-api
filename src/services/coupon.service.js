const { prisma } = require('../config/prisma');

function toCents(decimalValue) {
  const n = Number(decimalValue);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function normalizeCouponCode(code) {
  return String(code || '').trim().toUpperCase();
}

function itemMatchesRefs(item, product, refs) {
  return refs.some((ref) => {
    if (ref.type === 'PRODUCT' && ref.referenceId === item.productId) return true;
    if (ref.type === 'VARIANT' && ref.referenceId === item.variantId) return true;
    if (ref.type === 'CATEGORY' && product?.categoryId === ref.referenceId) return true;
    return false;
  });
}

function couponAppliesToItems(coupon, orderItems, productsById) {
  const refs = coupon.references || [];
  if (!refs.length) return true;

  return orderItems.some((item) => {
    const product = productsById.get(item.productId);
    return itemMatchesRefs(item, product, refs);
  });
}

/** Subtotal elegível ao cupom (só itens referenciados; sem refs = carrinho inteiro). */
function eligibleSubtotalCents(coupon, orderItems, productsById) {
  const refs = coupon.references || [];
  if (!refs.length) {
    return orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  }

  return orderItems.reduce((sum, item) => {
    const product = productsById.get(item.productId);
    if (!itemMatchesRefs(item, product, refs)) return sum;
    return sum + item.unitPrice * item.quantity;
  }, 0);
}

/**
 * Pedidos PENDING ainda válidos que “seguram” o cupom sem incrementar usedCount.
 * Assim abandono só ocupa vaga até expirar; o uso definitivo é no PAID.
 */
async function countPendingCouponHolds(tx, { couponCode, userId = null, excludeOrderId = null }) {
  const code = normalizeCouponCode(couponCode);
  if (!code) return 0;

  const now = new Date();
  return tx.order.count({
    where: {
      status: 'PENDING',
      couponCode: code,
      discount: { gt: 0 },
      // Legado: PENDING que já gravou CouponUsage já está no usedCount — não contar de novo
      couponUsage: null,
      OR: [
        { paymentExpiresAt: { gt: now } },
        { paymentExpiresAt: null },
      ],
      ...(userId ? { userId } : {}),
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
  });
}

/**
 * Valida cupom e calcula desconto em centavos (server-side).
 * Capacidade = usedCount (pagos) + holds PENDING ativos.
 */
async function validateCouponForOrder(tx, {
  code,
  userId,
  orderItems,
  subtotalCents,
  paymentMethod = 'PIX',
  excludeOrderId = null,
}) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) {
    return { discountCents: 0, coupon: null };
  }

  const coupon = await tx.coupon.findUnique({
    where: { code: normalized },
    include: { references: true },
  });

  if (!coupon) throw new Error('Cupom não encontrado');
  if (!coupon.isActive) throw new Error('Este cupom não está mais ativo');

  const now = new Date();
  if (coupon.startDate && new Date(coupon.startDate) > now) {
    throw new Error('Este cupom ainda não é válido');
  }
  if (coupon.endDate && new Date(coupon.endDate) < now) {
    throw new Error('Este cupom expirou');
  }

  if (coupon.maxUses != null) {
    const pendingHolds = await countPendingCouponHolds(tx, {
      couponCode: coupon.code,
      excludeOrderId,
    });
    if (coupon.usedCount + pendingHolds >= coupon.maxUses) {
      throw new Error('Este cupom atingiu o limite de usos');
    }
  }

  if (coupon.allowedPayments?.length > 0) {
    const allowed = coupon.allowedPayments.map((p) => String(p).toUpperCase());
    if (!allowed.includes(String(paymentMethod).toUpperCase())) {
      throw new Error('Cupom não válido para esta forma de pagamento');
    }
  }

  const minOrder = coupon.minOrderValue != null ? toCents(coupon.minOrderValue) : 0;
  if (minOrder > 0 && subtotalCents < minOrder) {
    throw new Error(`Pedido mínimo para este cupom: R$ ${(minOrder / 100).toFixed(2)}`);
  }

  const maxOrder = coupon.maxOrderValue != null ? toCents(coupon.maxOrderValue) : null;
  if (maxOrder != null && subtotalCents > maxOrder) {
    throw new Error('Valor do pedido excede o limite deste cupom');
  }

  if (coupon.perUserLimit != null && coupon.perUserLimit > 0 && userId) {
    const userUses = await tx.couponUsage.count({
      where: { couponId: coupon.id, userId },
    });
    const userPending = await countPendingCouponHolds(tx, {
      couponCode: coupon.code,
      userId,
      excludeOrderId,
    });
    if (userUses + userPending >= coupon.perUserLimit) {
      throw new Error('Você já utilizou este cupom o número máximo de vezes');
    }
  }

  const productIds = [...new Set(orderItems.map((i) => i.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, categoryId: true },
  });
  const productsById = new Map(products.map((p) => [p.id, p]));

  if (!couponAppliesToItems(coupon, orderItems, productsById)) {
    throw new Error('Cupom não se aplica aos itens do carrinho');
  }

  const baseCents = eligibleSubtotalCents(coupon, orderItems, productsById);
  if (baseCents <= 0) {
    throw new Error('Cupom não se aplica aos itens do carrinho');
  }

  let discountCents = 0;
  if (coupon.type === 'PERCENTAGE') {
    discountCents = Math.floor(baseCents * (Number(coupon.value) / 100));
    const maxDisc = coupon.maxDiscount != null ? toCents(coupon.maxDiscount) : null;
    if (maxDisc != null) discountCents = Math.min(discountCents, maxDisc);
  } else {
    discountCents = toCents(coupon.value);
  }

  discountCents = Math.min(Math.max(0, discountCents), baseCents, subtotalCents);
  return { discountCents, coupon };
}

async function recordCouponUsage(tx, { coupon, userId, orderId, discountCents, force = false }) {
  await tx.$executeRaw`SELECT 1 FROM "Coupon" WHERE id = ${coupon.id} FOR UPDATE`;

  const fresh = await tx.coupon.findUnique({ where: { id: coupon.id } });
  if (!fresh) throw new Error('Cupom não encontrado');

  if (!force) {
    if (fresh.maxUses != null && fresh.usedCount >= fresh.maxUses) {
      throw new Error('Este cupom atingiu o limite de usos');
    }

    if (fresh.perUserLimit != null && fresh.perUserLimit > 0) {
      const userUses = await tx.couponUsage.count({
        where: { couponId: coupon.id, userId },
      });
      if (userUses >= fresh.perUserLimit) {
        throw new Error('Você já utilizou este cupom o número máximo de vezes');
      }
    }
  }

  if (!force && fresh.maxUses != null) {
    const updated = await tx.coupon.updateMany({
      where: {
        id: coupon.id,
        usedCount: { lt: fresh.maxUses },
      },
      data: { usedCount: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new Error('Este cupom atingiu o limite de usos');
    }
  } else {
    await tx.coupon.update({
      where: { id: coupon.id },
      data: { usedCount: { increment: 1 } },
    });
  }

  await tx.couponUsage.create({
    data: {
      couponId: coupon.id,
      userId,
      orderId,
      discount: discountCents / 100,
    },
  });
}

/**
 * Consome o cupom de forma definitiva quando o pedido é pago.
 * Idempotente se CouponUsage já existir (legado PENDING→uso antigo).
 */
async function confirmCouponUsageForPaidOrder(tx, order) {
  const code = normalizeCouponCode(order.couponCode);
  if (!code || !order.discount || order.discount <= 0) return;

  const existing = await tx.couponUsage.findFirst({ where: { orderId: order.id } });
  if (existing) return;

  const coupon = await tx.coupon.findUnique({ where: { code } });
  if (!coupon) {
    console.warn('[confirmCouponUsageForPaidOrder] cupom sumiu', order.id, code);
    return;
  }

  try {
    await recordCouponUsage(tx, {
      coupon,
      userId: order.userId,
      orderId: order.id,
      discountCents: order.discount,
      force: false,
    });
  } catch (err) {
    // Corrida rara: dois PENDING pagam o último uso — pedido já cobrado; força o registro.
    console.warn('[confirmCouponUsageForPaidOrder] forçando uso após limite', order.id, err.message);
    await recordCouponUsage(tx, {
      coupon,
      userId: order.userId,
      orderId: order.id,
      discountCents: order.discount,
      force: true,
    });
  }
}

/** Libera uso de cupom quando pedido PENDING é cancelado/expira (legado + safety). */
async function releaseCouponUsage(tx, orderId) {
  const usage = await tx.couponUsage.findFirst({ where: { orderId } });
  if (!usage) return;

  await tx.$executeRaw`SELECT 1 FROM "Coupon" WHERE id = ${usage.couponId} FOR UPDATE`;
  await tx.couponUsage.delete({ where: { id: usage.id } });
  await tx.$executeRaw`
    UPDATE "Coupon"
    SET "usedCount" = GREATEST("usedCount" - 1, 0)
    WHERE id = ${usage.couponId}
  `;
}

module.exports = {
  validateCouponForOrder,
  recordCouponUsage,
  confirmCouponUsageForPaidOrder,
  releaseCouponUsage,
  eligibleSubtotalCents,
  normalizeCouponCode,
  countPendingCouponHolds,
};
