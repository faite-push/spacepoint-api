const { prisma } = require('../config/prisma');
const { sanitizeString, sanitizeSlug } = require('../utils/sanitize');
const {
  visibleVariantWhere,
  mapProductForStore,
  mapVariantForStore,
  mapProductsForStore,
  buildStoreStockMap,
} = require('../utils/productStore');
const { ensureDigitalStockSynced } = require('../utils/digitalStock');

function clampInt(value, fallback, min = null, max = null) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = fallback;
  if (min !== null && n < min) n = min;
  if (max !== null && n > max) n = max;
  return Math.floor(n);
}

async function collectDescendantCategoryIds(categoryId) {
  const ids = new Set([categoryId]);
  let queue = [categoryId];

  while (queue.length > 0) {
    const children = await prisma.category.findMany({
      where: { parentId: { in: queue }, isActive: true },
      select: { id: true },
    });

    queue = [];
    for (const child of children) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        queue.push(child.id);
      }
    }
  }

  return [...ids];
}

function buildOrderBy(sortBy, sortOrder) {
  const dir = sortOrder === 'asc' ? 'asc' : 'desc';

  switch (sortBy) {
    case 'price':
      return [{ price: dir }, { sortOrder: 'asc' }];
    case 'name':
      return [{ name: dir }];
    case 'newest':
      return [{ createdAt: dir }];
    default:
      return [{ featured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }];
  }
}

function buildProductWhere({
  search,
  categoryIds,
  platform,
  minPriceCents,
  maxPriceCents,
  inStock,
  featured,
}) {
  const where = {
    isActive: true,
    isVisible: true,
    ...(categoryIds?.length ? { categoryId: { in: categoryIds } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(platform
      ? { platform: { contains: platform, mode: 'insensitive' } }
      : {}),
    ...(featured === 'true' ? { featured: true } : {}),
    ...(minPriceCents != null
      ? { price: { gte: minPriceCents / 100 } }
      : {}),
    ...(maxPriceCents != null
      ? { price: { lte: maxPriceCents / 100 } }
      : {}),
    ...(inStock === 'true'
      ? {
          OR: [
            {
              AND: [
                { variants: { none: {} } },
                { stockQuantity: { gt: 0 } },
              ],
            },
            {
              variants: {
                some: {
                  ...visibleVariantWhere(),
                  stockQuantity: { gt: 0 },
                },
              },
            },
          ],
        }
      : {}),
  };

  return where;
}

class ProductController {
  async list(req, res) {
    try {
      const search = sanitizeString(req.query.search || '', 120);
      const categorySlug = sanitizeSlug(req.query.category || '');
      const platform = sanitizeString(req.query.platform || '', 40);
      const sortBy = sanitizeString(req.query.sortBy || 'relevance', 20);
      const sortOrder = sanitizeString(req.query.sortOrder || 'desc', 4);
      const inStock = sanitizeString(req.query.inStock || '', 5);
      const featured = sanitizeString(req.query.featured || '', 5);
      const includeSubcategories = req.query.includeSubcategories === 'true';

      const page = clampInt(req.query.page, 1, 1);
      const limit = clampInt(req.query.limit, 20, 1, 60);

      const minPriceCents = req.query.minPrice != null ? clampInt(req.query.minPrice, NaN, 0) : null;
      const maxPriceCents = req.query.maxPrice != null ? clampInt(req.query.maxPrice, NaN, 0) : null;

      let categoryIds = null;
      if (categorySlug) {
        const cat = await prisma.category.findFirst({
          where: { slug: categorySlug, isActive: true },
        });
        if (cat) {
          categoryIds = includeSubcategories
            ? await collectDescendantCategoryIds(cat.id)
            : [cat.id];
        } else {
          categoryIds = ['__none__'];
        }
      }

      const where = buildProductWhere({
        search,
        categoryIds,
        platform,
        minPriceCents: Number.isFinite(minPriceCents) ? minPriceCents : null,
        maxPriceCents: Number.isFinite(maxPriceCents) ? maxPriceCents : null,
        inStock,
        featured,
      });

      const [total, products, platformRows] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          orderBy: buildOrderBy(sortBy, sortOrder),
          skip: (page - 1) * limit,
          take: limit,
          include: {
            variants: {
              where: visibleVariantWhere(),
              orderBy: { sortOrder: 'asc' },
            },
          },
        }),
        prisma.product.findMany({
          where: { isActive: true, isVisible: true, platform: { not: null } },
          select: { platform: true },
          distinct: ['platform'],
          orderBy: { platform: 'asc' },
        }),
      ]);

      return res.json({
        products: await mapProductsForStore(prisma, products, req),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
        facets: {
          platforms: platformRows
            .map((row) => row.platform)
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'pt-BR')),
        },
      });
    } catch (err) {
      console.error('[Product.list]', err);
      return res.status(500).json({ error: 'Erro ao listar produtos' });
    }
  }

  async getBySlug(req, res) {
    try {
      const slug = sanitizeSlug(req.params.slug);
      const product = await prisma.product.findFirst({
        where: { slug, isActive: true, isVisible: true },
        include: {
          category: { select: { id: true, name: true, slug: true } },
          variants: {
            where: visibleVariantWhere(),
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

      const stockByKey = await buildStoreStockMap(prisma, [product]);

      return res.json({
        product: {
          ...mapProductForStore(product, product.variants, stockByKey, req),
          category: product.category,
        },
      });
    } catch (err) {
      console.error('[Product.getBySlug]', err);
      return res.status(500).json({ error: 'Erro ao buscar produto' });
    }
  }

  async getVariant(req, res) {
    try {
      const productId = sanitizeString(req.params.id, 60);
      const variantId = sanitizeString(req.params.variantId, 60);

      const variant = await prisma.productVariant.findFirst({
        where: {
          id: variantId,
          productId,
          ...visibleVariantWhere(),
          product: { isActive: true, isVisible: true },
        },
      });

      if (!variant) return res.status(404).json({ error: 'Variante não encontrada' });

      let availableCount = null;
      if (variant.deliveryType === 'automatic_lines') {
        availableCount = await ensureDigitalStockSynced(prisma, variant);
      }

      return res.json({ variant: mapVariantForStore(variant, availableCount, req) });
    } catch (err) {
      console.error('[Product.getVariant]', err);
      return res.status(500).json({ error: 'Erro ao buscar variante' });
    }
  }

  async addCodes(req, res) {
    const productId = sanitizeString(req.params.id, 80);
    const variantId = req.body?.variantId
      ? sanitizeString(req.body.variantId, 80)
      : null;
    const codes = Array.isArray(req.body.codes)
      ? req.body.codes.map((code) => sanitizeString(code, 200)).filter(Boolean)
      : [];

    if (!codes.length || codes.length > 500) {
      return res.status(400).json({ error: 'Informe entre 1 e 500 códigos' });
    }

    if (variantId) {
      const variant = await prisma.productVariant.findFirst({
        where: { id: variantId, productId },
      });
      if (!variant) return res.status(400).json({ error: 'Variante inválida' });
    }

    await prisma.productCode.createMany({
      data: codes.map((code) => ({ productId, variantId, code })),
      skipDuplicates: true,
    });

    return res.status(201).json({ success: true, count: codes.length });
  }
}

module.exports = new ProductController();