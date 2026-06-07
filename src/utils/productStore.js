/** Converte preço Decimal/string/number (BRL) para centavos inteiros */
function priceToCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function visibleVariantWhere() {
  return { isActive: true, isVisible: true };
}

function mapVariantForStore(v) {
  return {
    id: v.id,
    productId: v.productId,
    sku: v.sku || null,
    name: v.name,
    description: v.description,
    price: priceToCents(v.price),
    comparePrice: v.comparePrice != null ? priceToCents(v.comparePrice) : null,
    imageUrl: v.imageUrl || null,
    stockQuantity: v.stockQuantity ?? 0,
    minPurchaseQuantity: v.minPurchaseQuantity ?? 1,
    maxPurchaseQuantity: v.maxPurchaseQuantity,
    onePurchasePerUser: v.onePurchasePerUser ?? false,
    deliveryType: v.deliveryType,
    sortOrder: v.sortOrder,
  };
}

function mapProductForStore(product, variants = []) {
  const visibleVariants = variants.map(mapVariantForStore);
  const hasVariants = visibleVariants.length > 0;
  const prices = hasVariants
    ? visibleVariants.map((v) => v.price)
    : [priceToCents(product.price)];

  const minPrice = Math.min(...prices.filter((p) => p > 0));
  const image =
    product.imageUrl ||
    (Array.isArray(product.gallery) && product.gallery[0]) ||
    (Array.isArray(product.images) && product.images[0]) ||
    null;

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
    images: image ? [image, ...(product.gallery || []).filter((u) => u !== image)] : product.images || [],
    imageUrl: image,
    platform: product.platform || "Digital",
    isDigital: product.isDigital !== false,
    featured: product.featured ?? false,
    stockQuantity: product.stockQuantity ?? 0,
    variants: visibleVariants,
  };
}

/**
 * Resolve unidade vendável (produto simples ou variante).
 * @returns {{ product, variant, unitPriceCents, variantName, requiresVariant }}
 */
async function resolveSellable(tx, productId, variantId) {
  const product = await tx.product.findFirst({
    where: { id: productId, isActive: true, isVisible: true },
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

    if (variant.stockQuantity <= 0 && variant.deliveryType === 'automatic_lines') {
      const codeCount = await tx.productCode.count({
        where: {
          status: 'AVAILABLE',
          OR: [{ variantId: variant.id }, { productId: product.id, variantId: null }],
        },
      });
      if (codeCount < 1) throw new Error('Variante sem estoque');
    }

    return {
      product,
      variant,
      unitPriceCents: priceToCents(variant.price),
      variantName: variant.name,
      requiresVariant: true,
    };
  }

  if (variantId) throw new Error('Este produto não possui variantes');

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
  resolveSellable,
};
