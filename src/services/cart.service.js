const { prisma } = require('../config/prisma');
const { priceToCents, visibleVariantWhere } = require('../utils/productStore');

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeEmail(email) {
  if (!isValidEmail(email)) return null;
  return email.trim().toLowerCase();
}

function mergeCartItems(existingItems, incomingItems) {
  const map = new Map();

  for (const item of existingItems) {
    const key = `${item.productId}:${item.variantId ?? ''}`;
    map.set(key, { ...item });
  }

  for (const item of incomingItems) {
    const key = `${item.productId}:${item.variantId ?? ''}`;
    const current = map.get(key);
    if (!current) {
      map.set(key, { ...item });
      continue;
    }
    map.set(key, {
      ...current,
      quantity: Math.max(current.quantity, item.quantity),
      unitPrice: item.unitPrice,
    });
  }

  return [...map.values()];
}

async function normalizeCartItems(tx, rawItems) {
  const normalized = [];

  for (const item of rawItems || []) {
    const productId = String(item.productId || '').trim();
    const variantId = item.variantId ? String(item.variantId).trim() : null;
    const quantity = Math.max(1, Math.min(10, Number(item.quantity) || 1));

    if (!productId) continue;

    const product = await tx.product.findFirst({
      where: { id: productId, isActive: true, isVisible: true },
      include: {
        variants: {
          where: visibleVariantWhere(),
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!product) continue;

    if (variantId) {
      const variant = product.variants.find((row) => row.id === variantId);
      if (!variant) continue;

      normalized.push({
        productId: product.id,
        variantId: variant.id,
        quantity,
        unitPrice: priceToCents(variant.price),
        label: `${product.name} — ${variant.name}`,
      });
      continue;
    }

    if (product.variants.length > 0) continue;

    normalized.push({
      productId: product.id,
      variantId: null,
      quantity,
      unitPrice: priceToCents(product.price),
      label: product.name,
    });
  }

  return normalized;
}

async function findCartByIdentity(tx, { userId, visitorId }) {
  if (userId) {
    const userCart = await tx.abandonedCart.findUnique({ where: { userId } });
    if (userCart) return userCart;
  }

  if (visitorId) {
    return tx.abandonedCart.findUnique({ where: { visitorId } });
  }

  return null;
}

async function mergeVisitorCartIntoUserCart(tx, userId, visitorId) {
  if (!userId || !visitorId) return null;

  const [userCart, visitorCart] = await Promise.all([
    tx.abandonedCart.findUnique({
      where: { userId },
      include: { items: true },
    }),
    tx.abandonedCart.findUnique({
      where: { visitorId },
      include: { items: true },
    }),
  ]);

  if (!visitorCart) return userCart;
  if (!userCart) {
    return tx.abandonedCart.update({
      where: { id: visitorCart.id },
      data: { userId, visitorId: null },
      include: { items: true },
    });
  }

  if (visitorCart.id === userCart.id) return userCart;

  const mergedItems = mergeCartItems(
    userCart.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    visitorCart.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    }))
  );

  await tx.abandonedCartItem.deleteMany({ where: { cartId: userCart.id } });
  await tx.abandonedCartItem.createMany({
    data: mergedItems.map((item) => ({
      cartId: userCart.id,
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
  });

  const subtotalCents = mergedItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  const updated = await tx.abandonedCart.update({
    where: { id: userCart.id },
    data: {
      subtotalCents,
      email: userCart.email || visitorCart.email,
      customerName: userCart.customerName || visitorCart.customerName,
      couponCode: userCart.couponCode || visitorCart.couponCode,
      lastActivityAt: new Date(),
      convertedAt: null,
    },
    include: { items: true },
  });

  await tx.abandonedCart.delete({ where: { id: visitorCart.id } });
  return updated;
}

async function persistCartItems(tx, cartId, items) {
  await tx.abandonedCartItem.deleteMany({ where: { cartId } });

  if (items.length > 0) {
    await tx.abandonedCartItem.createMany({
      data: items.map((item) => ({
        cartId,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    });
  }
}

async function syncCart({
  userId,
  visitorId,
  email,
  customerName,
  couponCode,
  items,
  userEmail,
  userName,
}) {
  if (!userId && !visitorId) {
    const err = new Error('Identificador do carrinho ausente');
    err.status = 400;
    throw err;
  }

  const normalizedItems = await prisma.$transaction((tx) => normalizeCartItems(tx, items));

  if (normalizedItems.length === 0) {
    await markConverted({ userId, visitorId });
    return { synced: true, empty: true };
  }

  const resolvedEmail = normalizeEmail(email) || normalizeEmail(userEmail);
  const resolvedName = String(customerName || userName || '').trim() || null;
  const subtotalCents = normalizedItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  const cart = await prisma.$transaction(async (tx) => {
    let existing = await mergeVisitorCartIntoUserCart(tx, userId, visitorId);

    if (!existing) {
      existing = await findCartByIdentity(tx, { userId, visitorId });
    }

    const data = {
      userId: userId || null,
      visitorId: userId ? null : visitorId || null,
      subtotalCents,
      couponCode: couponCode || null,
      lastActivityAt: new Date(),
      convertedAt: null,
      ...(existing?.convertedAt ? { recoveryEmailSentAt: null } : {}),
      ...(resolvedEmail ? { email: resolvedEmail } : {}),
      ...(resolvedName ? { customerName: resolvedName } : {}),
    };

    if (existing) {
      await persistCartItems(tx, existing.id, normalizedItems);
      return tx.abandonedCart.update({
        where: { id: existing.id },
        data,
      });
    }

    const created = await tx.abandonedCart.create({ data });
    await persistCartItems(tx, created.id, normalizedItems);
    return created;
  });

  return { synced: true, cartId: cart.id, subtotalCents: cart.subtotalCents };
}

async function captureEmail({ userId, visitorId, email, customerName, phone, document, userEmail, userName }) {
  const resolvedEmail = normalizeEmail(email) || normalizeEmail(userEmail);
  if (!resolvedEmail) {
    const err = new Error('E-mail inválido');
    err.status = 400;
    throw err;
  }

  if (!userId && !visitorId) {
    const err = new Error('Identificador do carrinho ausente');
    err.status = 400;
    throw err;
  }

  const resolvedName = String(customerName || userName || '').trim() || null;
  const resolvedPhone = String(phone || '').replace(/\D/g, '') || null;
  const resolvedDocument = String(document || '').replace(/\D/g, '') || null;

  const cart = await findCartByIdentity(prisma, { userId, visitorId });
  if (!cart) {
    return { captured: false, reason: 'cart_not_found' };
  }

  await prisma.abandonedCart.update({
    where: { id: cart.id },
    data: {
      email: resolvedEmail,
      ...(resolvedName ? { customerName: resolvedName } : {}),
      ...(resolvedPhone ? { phone: resolvedPhone } : {}),
      ...(resolvedDocument ? { document: resolvedDocument } : {}),
      lastActivityAt: new Date(),
    },
  });

  return { captured: true };
}

async function markConverted({ userId, visitorId }) {
  const conditions = [];
  if (userId) conditions.push({ userId });
  if (visitorId) conditions.push({ visitorId });

  if (!conditions.length) return { converted: 0 };

  const result = await prisma.abandonedCart.updateMany({
    where: {
      OR: conditions,
      convertedAt: null,
    },
    data: {
      convertedAt: new Date(),
    },
  });

  return { converted: result.count };
}

async function listRecoverableCartIds({ delayHours, inactivityMinutes, minSubtotalCents, limit = 50 }) {
  const emailCutoff = new Date(Date.now() - delayHours * 60 * 60 * 1000);
  const inactivityCutoff =
    inactivityMinutes && inactivityMinutes > 0
      ? new Date(Date.now() - inactivityMinutes * 60 * 1000)
      : emailCutoff;
  // E-mail só depois do delay; e nunca antes de estar "abandonado" na listagem
  const cutoff = emailCutoff < inactivityCutoff ? emailCutoff : inactivityCutoff;

  const carts = await prisma.abandonedCart.findMany({
    where: {
      convertedAt: null,
      archivedAt: null,
      recoveryEmailSentAt: null,
      email: { not: null },
      subtotalCents: { gte: minSubtotalCents },
      lastActivityAt: { lte: cutoff },
      items: { some: {} },
    },
    select: {
      id: true,
      userId: true,
      email: true,
    },
    orderBy: { lastActivityAt: 'asc' },
    take: limit,
  });

  if (!carts.length) return [];

  const filtered = [];
  for (const cart of carts) {
    if (cart.userId) {
      const recentOrder = await prisma.order.findFirst({
        where: {
          userId: cart.userId,
          status: { in: ['PENDING', 'PAID', 'DELIVERED'] },
          createdAt: { gte: cutoff },
        },
        select: { id: true },
      });
      if (recentOrder) continue;
    }

    filtered.push(cart.id);
  }

  return filtered;
}

module.exports = {
  syncCart,
  captureEmail,
  markConverted,
  listRecoverableCartIds,
  normalizeCartItems,
};
