const {
  ensureDigitalStockSynced,
  getAvailableStockCount,
  resolveDisplayStock,
  validateStockQuantity,
} = require('./digitalStock');
const { resolveMediaUrl, resolveMediaUrls } = require('./mediaUrl');

/** Converte preço Decimal/string/number (BRL) para centavos inteiros */
function priceToCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function visibleVariantWhere() {
  return { isActive: true, isVisible: true };
}

function mapVariantForStore(v, availableCodeCount = null, req = null) {
  return {
    id: v.id,
    productId: v.productId,
    sku: v.sku || null,
    name: v.name,
    description: v.description,
    price: priceToCents(v.price),
    comparePrice: v.comparePrice != null ? priceToCents(v.comparePrice) : null,
    imageUrl: resolveMediaUrl(v.imageUrl || null, req),
    stockQuantity: resolveDisplayStock(v, availableCodeCount),
    minPurchaseQuantity: v.minPurchaseQuantity ?? 1,
    maxPurchaseQuantity: v.maxPurchaseQuantity,
    onePurchasePerUser: v.onePurchasePerUser ?? false,
    deliveryType: v.deliveryType,
    sortOrder: v.sortOrder,
  };
}

function mapProductForStore(product, variants = [], stockByKey = new Map(), req = null) {
  const visibleVariants = variants.map((v) =>
    mapVariantForStore(v, stockByKey.get(`variant:${v.id}`) ?? null, req)
  );
  const hasVariants = visibleVariants.length > 0;
  const prices = hasVariants
    ? visibleVariants.map((v) => v.price)
    : [priceToCents(product.price)];

  const minPrice = Math.min(...prices.filter((p) => p > 0));
  const rawImage =
    product.imageUrl ||
    (Array.isArray(product.gallery) && product.gallery[0]) ||
    (Array.isArray(product.images) && product.images[0]) ||
    null;
  const image = resolveMediaUrl(rawImage, req);
  const gallery = resolveMediaUrls(product.gallery || [], req);
  const legacyImages = resolveMediaUrls(product.images || [], req);

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    price: hasVariants ? minPrice : priceToCents(product.price),
    comparePrice: product.comparePrice != null ? priceToCents(product.comparePrice) : null,
    priceFrom: hasVariants,
    hasVariants,
    variantCount: visibleVariants.length,
    images: image ? [image, ...gallery.filter((u) => u !== image)] : legacyImages,
    imageUrl: image,
    platform: product.platform || "Digital",
    isDigital: product.isDigital !== false,
    featured: product.featured ?? false,
    stockQuantity: hasVariants
      ? visibleVariants.reduce((sum, v) => sum + (v.stockQuantity ?? 0), 0)
      : resolveDisplayStock(product, stockByKey.get(`product:${product.id}`) ?? null),
    variants: visibleVariants,
  };
}

async function buildStoreStockMap(tx, products) {
  const stockByKey = new Map();

  for (const product of products) {
    const variants = product.variants || [];
    if (variants.length > 0) {
      for (const variant of variants) {
        if (variant.deliveryType === 'automatic_lines') {
          const count = await ensureDigitalStockSynced(tx, variant);
          stockByKey.set(`variant:${variant.id}`, count);
        }
      }
    } else if (product.deliveryType === 'automatic_lines') {
      const count = await ensureDigitalStockSynced(tx, product);
      stockByKey.set(`product:${product.id}`, count);
    }
  }

  return stockByKey;
}

async function mapProductsForStore(tx, products, req = null) {
  const stockByKey = await buildStoreStockMap(tx, products);
  return products.map((p) => mapProductForStore(p, p.variants || [], stockByKey, req));
}

/**
 * Resolve unidade vendável (produto simples ou variante).
 * @returns {{ product, variant, unitPriceCents, variantName, requiresVariant }}
 */
async function assertOnePurchasePerUser(tx, userId, product, variant) {
  const entity = variant || product;
  if (!entity?.onePurchasePerUser) return;

  const existing = await tx.order.findFirst({
    where: {
      userId,
      status: { in: ['PENDING', 'PAID', 'DELIVERED'] },
      items: {
        some: {
          productId: product.id,
          ...(variant ? { variantId: variant.id } : { variantId: null }),
        },
      },
    },
    select: { id: true },
  });

  if (existing) {
    throw new Error('Você já possui uma compra deste produto');
  }
}

async function resolveSellable(tx, productId, variantId, quantity = 1, userId = null) {
  const product = await tx.product.findFirst({
    where: { id: productId, isActive: true },
    include: {
      variants: {
        where: visibleVariantWhere(),
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!product) throw new Error('Produto indisponível');

  const visibleVariants = product.variants || [];
  const hasVariants = visibleVariants.length > 0;

  if (hasVariants) {
    if (!variantId) {
      throw new Error('Selecione uma variante para continuar');
    }
    const variant = visibleVariants.find((v) => v.id === variantId);
    if (!variant) throw new Error('Variante indisponível');

    if (userId) await assertOnePurchasePerUser(tx, userId, product, variant);

    await ensureDigitalStockSynced(tx, variant);
    const codeCount =
      variant.deliveryType === 'automatic_lines'
        ? await getAvailableStockCount(tx, productId, variant.id)
        : null;
    validateStockQuantity(variant, quantity, codeCount ?? 0);

    return {
      product,
      variant,
      unitPriceCents: priceToCents(variant.price),
      variantName: variant.name,
      requiresVariant: true,
    };
  }

  if (variantId) throw new Error('Este produto não possui a variante selecionada');

  if (userId) await assertOnePurchasePerUser(tx, userId, product, null);

  await ensureDigitalStockSynced(tx, product);
  const codeCount =
    product.deliveryType === 'automatic_lines'
      ? await getAvailableStockCount(tx, product.id, null)
      : null;
  validateStockQuantity(product, quantity, codeCount ?? 0);

  return {
    product,
    variant: null,
    unitPriceCents: priceToCents(product.price),
    variantName: null,
    requiresVariant: false,
  };
}

module.exports = {
  priceToCents,
  visibleVariantWhere,
  mapVariantForStore,
  mapProductForStore,
  mapProductsForStore,
  buildStoreStockMap,
  resolveSellable,
};
