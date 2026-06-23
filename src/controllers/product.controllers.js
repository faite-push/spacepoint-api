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

class ProductController {
  async list(req, res) {
    try {
      const search = sanitizeString(req.query.search || '', 120);
      const categorySlug = sanitizeSlug(req.query.category || '');

      let categoryId = null;
      if (categorySlug) {
        const cat = await prisma.category.findFirst({
          where: { slug: categorySlug, isActive: true },
        });
        if (cat) categoryId = cat.id;
      }

      const products = await prisma.product.findMany({
        where: {
          isActive: true,
          isVisible: true,
          ...(categoryId ? { categoryId } : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { slug: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
        include: {
          variants: {
            where: visibleVariantWhere(),
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      return res.json({
        products: await mapProductsForStore(prisma, products, req),
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
