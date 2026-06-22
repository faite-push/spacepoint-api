const { prisma } = require('../config/prisma');

function toCents(decimalValue) {
  const n = Number(decimalValue);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function couponAppliesToItems(coupon, orderItems, productsById) {
  const refs = coupon.references || [];
  if (!refs.length) return true;

  return orderItems.some((item) => {
    const product = productsById.get(item.productId);
    return refs.some((ref) => {
      if (ref.type === 'PRODUCT' && ref.referenceId === item.productId) return true;
      if (ref.type === 'VARIANT' && ref.referenceId === item.variantId) return true;
      if (ref.type === 'CATEGORY' && product?.categoryId === ref.referenceId) return true;
      return false;
    });
  });
}

/**
 * Valida cupom e calcula desconto em centavos (server-side).
 */
async function validateCouponForOrder(tx, { code, userId, orderItems, subtotalCents, paymentMethod = 'PIX' }) {
  if (!code || !String(code).trim()) {
    return { discountCents: 0, coupon: null };
  }

  const coupon = await tx.coupon.findUnique({
    where: { code: String(code).trim().toUpperCase() },
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
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    throw new Error('Este cupom atingiu o limite de usos');
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

  if (coupon.perUserLimit != null && coupon.perUserLimit > 0) {
    const userUses = await tx.couponUsage.count({
      where: { couponId: coupon.id, userId },
    });
    if (userUses >= coupon.perUserLimit) {
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

  let discountCents = 0;
  if (coupon.type === 'PERCENTAGE') {
    discountCents = Math.floor(subtotalCents * (Number(coupon.value) / 100));
    const maxDisc = coupon.maxDiscount != null ? toCents(coupon.maxDiscount) : null;
    if (maxDisc != null) discountCents = Math.min(discountCents, maxDisc);
  } else {
    discountCents = toCents(coupon.value);
  }

  discountCents = Math.min(Math.max(0, discountCents), subtotalCents);
  return { discountCents, coupon };
}

async function recordCouponUsage(tx, { coupon, userId, orderId, discountCents }) {
  await tx.couponUsage.create({
    data: {
      couponId: coupon.id,
      userId,
      orderId,
      discount: discountCents / 100,
    },
  });
  await tx.coupon.update({
    where: { id: coupon.id },
    data: { usedCount: { increment: 1 } },
  });
}

module.exports = {
  validateCouponForOrder,
  recordCouponUsage,
};
