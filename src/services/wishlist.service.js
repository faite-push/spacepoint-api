const { prisma } = require('../config/prisma');
const { mapProductsForStore, visibleVariantWhere } = require('../utils/productStore');

const productInclude = {
  variants: {
    where: visibleVariantWhere(),
    orderBy: { sortOrder: 'asc' },
  },
};

async function listProductsForUser(userId, req) {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { product: { include: productInclude } },
  });

  const products = rows
    .map((row) => row.product)
    .filter((product) => product && product.isActive && product.isVisible);

  return mapProductsForStore(prisma, products, req);
}

async function assertVisibleProduct(productId) {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true, isVisible: true },
    select: { id: true },
  });

  if (!product) {
    const err = new Error('Produto não encontrado');
    err.status = 404;
    throw err;
  }

  return product;
}

async function addItem(userId, productId) {
  await assertVisibleProduct(productId);

  await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: {},
  });
}

async function removeItem(userId, productId) {
  await prisma.wishlistItem.deleteMany({
    where: { userId, productId },
  });
}

async function syncItems(userId, productIds, req) {
  const uniqueIds = [...new Set((productIds || []).filter(Boolean))];

  if (uniqueIds.length > 0) {
    const validProducts = await prisma.product.findMany({
      where: {
        id: { in: uniqueIds },
        isActive: true,
        isVisible: true,
      },
      select: { id: true },
    });

    const validIds = new Set(validProducts.map((product) => product.id));
    const existing = await prisma.wishlistItem.findMany({
      where: { userId },
      select: { productId: true },
    });
    const existingIds = new Set(existing.map((row) => row.productId));

    const toAdd = [...validIds].filter((id) => !existingIds.has(id));

    if (toAdd.length > 0) {
      await prisma.wishlistItem.createMany({
        data: toAdd.map((productId) => ({ userId, productId })),
        skipDuplicates: true,
      });
    }
  }

  return listProductsForUser(userId, req);
}

module.exports = {
  listProductsForUser,
  addItem,
  removeItem,
  syncItems,
};
