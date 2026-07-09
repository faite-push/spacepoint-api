const { prisma } = require('../config/prisma');
const { sanitizeString, sanitizeSlug } = require('../utils/sanitize');
const { syncDigitalStock } = require('../utils/digitalStock');

const DELIVERY_TYPES = ['automatic_lines', 'file', 'manual_chat', 'mixed', 'manual', 'automatic_text'];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function generateUniqueSlug(name, ignoreId = null) {
  const base = sanitizeSlug(name) || 'produto';
  let slug = base;
  let n = 1;
  while (n < 50) {
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (!existing || existing.id === ignoreId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

function toDecimalOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampInt(v, fallback, min = null, max = null) {
  let n = Number(v);
  if (!Number.isFinite(n)) n = fallback;
  if (min !== null && n < min) n = min;
  if (max !== null && n > max) n = max;
  return Math.floor(n);
}

function sanitizeStringArray(arr, maxItems = 1000, maxLen = 500) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((s) => s.slice(0, maxLen));
}

/**
 * Aceita description/postPurchaseInstructions como objeto JSON (Tiptap) ou null.
 * Filtramos para evitar valores absurdamente grandes.
 */
function sanitizeJson(value) {
  if (value === null || value === undefined) return null;
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (str.length > 200_000) return null; // limite ~200kb
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function computeAdjustedPrice(current, mode, value) {
  const base = Number(current) || 0;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;

  if (mode === 'fixed') return roundMoney(Math.max(0.01, amount));
  if (mode === 'increase_percent') return roundMoney(Math.max(0.01, base * (1 + amount / 100)));
  if (mode === 'decrease_percent') return roundMoney(Math.max(0.01, base * (1 - amount / 100)));
  return null;
}

async function resolveBulkProductIds(productIds) {
  if (Array.isArray(productIds) && productIds.length > 0) {
    const ids = [...new Set(productIds.map((id) => sanitizeString(String(id), 60)).filter(Boolean))];
    if (ids.length > 1000) {
      const err = new Error('Máximo de 1000 produtos por ação em massa');
      err.status = 400;
      throw err;
    }
    return ids;
  }

  const all = await prisma.product.findMany({ select: { id: true } });
  return all.map((p) => p.id);
}

// ─── Controller ──────────────────────────────────────────────────────────────

class ProductAdminController {
  async list(req, res) {
    try {
      const search = sanitizeString(req.query.search || '', 120);
      const categoryId = sanitizeString(req.query.categoryId || '', 60);
      const visibility = sanitizeString(req.query.visibility || '', 20); // visible|hidden|all
      const page = clampInt(req.query.page, 1, 1);
      const pageSize = clampInt(req.query.pageSize, 25, 1, 100);

      const where = {
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { slug: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(visibility === 'visible' ? { isVisible: true } : {}),
        ...(visibility === 'hidden' ? { isVisible: false } : {}),
      };

      const [total, products] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            category: { select: { id: true, name: true, slug: true } },
            _count: { select: { codes: true, variants: true } },
          },
        }),
      ]);

      return res.json({
        products,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
      });
    } catch (err) {
      console.error('[ProductAdmin.list]', err);
      return res.status(500).json({ error: 'Erro ao listar produtos' });
    }
  }

  async getById(req, res) {
    try {
      const id = sanitizeString(req.params.id, 60);
      const product = await prisma.product.findUnique({
        where: { id },
        include: {
          category: { select: { id: true, name: true, slug: true, parentId: true } },
        },
      });
      if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
      return res.json(product);
    } catch (err) {
      console.error('[ProductAdmin.getById]', err);
      return res.status(500).json({ error: 'Erro ao buscar produto' });
    }
  }

  async create(req, res) {
    try {
      const name = sanitizeString(req.body?.name, 120);
      if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

      const price = toDecimalOrNull(req.body?.price);
      if (price === null || price < 0) {
        return res.status(400).json({ error: 'Preço inválido' });
      }

      const slug = await generateUniqueSlug(name);

      const categoryId = req.body?.categoryId
        ? sanitizeString(req.body.categoryId, 60)
        : null;
      if (categoryId) {
        const cat = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!cat) return res.status(400).json({ error: 'Categoria inválida' });
      }

      const deliveryType = DELIVERY_TYPES.includes(req.body?.deliveryType)
        ? req.body.deliveryType
        : 'automatic_lines';

      const created = await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            name,
            slug,
            description: sanitizeJson(req.body?.description),
            price,
            comparePrice: toDecimalOrNull(req.body?.comparePrice),
            imageUrl: req.body?.imageUrl ? sanitizeString(req.body.imageUrl, 500) : null,
            gallery: sanitizeStringArray(req.body?.gallery, 20),
            stockQuantity: clampInt(req.body?.stockQuantity, 0, 0),
            minPurchaseQuantity: clampInt(req.body?.minPurchaseQuantity, 1, 1),
            maxPurchaseQuantity:
              req.body?.maxPurchaseQuantity === null || req.body?.maxPurchaseQuantity === undefined
                ? null
                : clampInt(req.body.maxPurchaseQuantity, 1, 1),
            onePurchasePerUser: Boolean(req.body?.onePurchasePerUser),
            isVisible: req.body?.isVisible !== undefined ? Boolean(req.body.isVisible) : true,
            isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true,
            featured: Boolean(req.body?.featured),
            categoryId: categoryId || null,
            deliveryType,
            digitalLines: sanitizeStringArray(req.body?.digitalLines, 5000, 2000),
            digitalFileUrl: req.body?.digitalFileUrl
              ? sanitizeString(req.body.digitalFileUrl, 500)
              : null,
            manualDeliveryNote: req.body?.manualDeliveryNote
              ? sanitizeString(req.body.manualDeliveryNote, 2000)
              : null,
            postPurchaseInstructions: sanitizeJson(req.body?.postPurchaseInstructions),
            platform: req.body?.platform ? sanitizeString(req.body.platform, 40) : null,
          },
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        });

        if (product.deliveryType === 'automatic_lines') {
          const { availableCount } = await syncDigitalStock(tx, {
            productId: product.id,
            digitalLines: product.digitalLines ?? [],
          });
          return tx.product.update({
            where: { id: product.id },
            data: { stockQuantity: availableCount },
            include: {
              category: { select: { id: true, name: true, slug: true } },
            },
          });
        }

        return product;
      });
      return res.status(201).json(created);
    } catch (err) {
      console.error('[ProductAdmin.create]', err);
      return res.status(500).json({ error: 'Erro ao criar produto' });
    }
  }

  async update(req, res) {
    try {
      const id = sanitizeString(req.params.id, 60);
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: 'Produto não encontrado' });

      const data = {};

      if (req.body?.name !== undefined) {
        const name = sanitizeString(req.body.name, 120);
        if (!name) return res.status(400).json({ error: 'Nome inválido' });
        data.name = name;
        if (name !== existing.name) {
          data.slug = await generateUniqueSlug(name, id);
        }
      }

      if (req.body?.price !== undefined) {
        const p = toDecimalOrNull(req.body.price);
        if (p === null || p < 0) return res.status(400).json({ error: 'Preço inválido' });
        data.price = p;
      }

      if (req.body?.comparePrice !== undefined) {
        data.comparePrice = toDecimalOrNull(req.body.comparePrice);
      }

      if (req.body?.description !== undefined) {
        data.description = sanitizeJson(req.body.description);
      }
      if (req.body?.postPurchaseInstructions !== undefined) {
        data.postPurchaseInstructions = sanitizeJson(req.body.postPurchaseInstructions);
      }

      if (req.body?.imageUrl !== undefined) {
        data.imageUrl = req.body.imageUrl ? sanitizeString(req.body.imageUrl, 500) : null;
      }
      if (req.body?.gallery !== undefined) {
        data.gallery = sanitizeStringArray(req.body.gallery, 20);
      }

      if (req.body?.stockQuantity !== undefined) {
        data.stockQuantity = clampInt(req.body.stockQuantity, 0, 0);
      }
      if (req.body?.minPurchaseQuantity !== undefined) {
        data.minPurchaseQuantity = clampInt(req.body.minPurchaseQuantity, 1, 1);
      }
      if (req.body?.maxPurchaseQuantity !== undefined) {
        data.maxPurchaseQuantity =
          req.body.maxPurchaseQuantity === null
            ? null
            : clampInt(req.body.maxPurchaseQuantity, 1, 1);
      }
      if (req.body?.onePurchasePerUser !== undefined) {
        data.onePurchasePerUser = Boolean(req.body.onePurchasePerUser);
      }
      if (req.body?.isVisible !== undefined) data.isVisible = Boolean(req.body.isVisible);
      if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
      if (req.body?.featured !== undefined) data.featured = Boolean(req.body.featured);

      if (req.body?.categoryId !== undefined) {
        const cid = req.body.categoryId ? sanitizeString(req.body.categoryId, 60) : null;
        if (cid) {
          const cat = await prisma.category.findUnique({ where: { id: cid } });
          if (!cat) return res.status(400).json({ error: 'Categoria inválida' });
        }
        data.categoryId = cid;
      }

      if (req.body?.deliveryType !== undefined) {
        if (!DELIVERY_TYPES.includes(req.body.deliveryType)) {
          return res.status(400).json({ error: 'Tipo de entrega inválido' });
        }
        data.deliveryType = req.body.deliveryType;
      }
      if (req.body?.digitalLines !== undefined) {
        data.digitalLines = sanitizeStringArray(req.body.digitalLines, 5000, 2000);
      }
      if (req.body?.digitalFileUrl !== undefined) {
        data.digitalFileUrl = req.body.digitalFileUrl
          ? sanitizeString(req.body.digitalFileUrl, 500)
          : null;
      }
      if (req.body?.manualDeliveryNote !== undefined) {
        data.manualDeliveryNote = req.body.manualDeliveryNote
          ? sanitizeString(req.body.manualDeliveryNote, 2000)
          : null;
      }
      if (req.body?.platform !== undefined) {
        data.platform = req.body.platform ? sanitizeString(req.body.platform, 40) : null;
      }

      const updated = await prisma.$transaction(async (tx) => {
        const product = await tx.product.update({
          where: { id },
          data,
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        });

        const variantCount = await tx.productVariant.count({ where: { productId: id } });
        if (variantCount === 0 && product.deliveryType === 'automatic_lines') {
          const { availableCount } = await syncDigitalStock(tx, {
            productId: product.id,
            digitalLines: product.digitalLines ?? [],
          });
          return tx.product.update({
            where: { id: product.id },
            data: { stockQuantity: availableCount },
            include: {
              category: { select: { id: true, name: true, slug: true } },
            },
          });
        }

        return product;
      });
      return res.json(updated);
    } catch (err) {
      console.error('[ProductAdmin.update]', err);
      return res.status(500).json({ error: 'Erro ao atualizar produto' });
    }
  }

  async remove(req, res) {
    try {
      const id = sanitizeString(req.params.id, 60);
      const existing = await prisma.product.findUnique({
        where: { id },
        include: { _count: { select: { orderItems: true } } },
      });
      if (!existing) return res.status(404).json({ error: 'Produto não encontrado' });
      if (existing._count.orderItems > 0) {
        return res.status(409).json({
          error: 'Produto possui pedidos associados. Desative-o em vez de excluir.',
        });
      }
      await prisma.product.delete({ where: { id } });
      return res.json({ success: true });
    } catch (err) {
      console.error('[ProductAdmin.remove]', err);
      return res.status(500).json({ error: 'Erro ao excluir produto' });
    }
  }

  async reorder(req, res) {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Formato inválido' });
      }

      await prisma.$transaction(
        items.map((item) =>
          prisma.product.update({
            where: { id: String(item.id) },
            data: { sortOrder: Number(item.sortOrder) },
          })
        )
      );

      return res.json({ success: true });
    } catch (err) {
      console.error('[ProductAdmin.reorder]', err);
      return res.status(500).json({ error: 'Erro ao reordenar produtos' });
    }
  }

  async convertToVariant(req, res) {
    try {
      const sourceId = sanitizeString(req.params.id, 60);
      const targetProductId = sanitizeString(req.body?.targetProductId, 60);

      if (!targetProductId) {
        return res.status(400).json({ error: 'Selecione o pacote de destino' });
      }
      if (sourceId === targetProductId) {
        return res.status(400).json({
          error: 'Não é possível converter o pacote em variante de si mesmo',
        });
      }

      const source = await prisma.product.findUnique({
        where: { id: sourceId },
        include: {
          _count: { select: { orderItems: true, variants: true } },
        },
      });
      if (!source) return res.status(404).json({ error: 'Produto não encontrado' });

      if (source._count.orderItems > 0) {
        return res.status(409).json({
          error: 'Este pacote possui pedidos e não pode ser convertido em variante',
        });
      }
      if (source._count.variants > 0) {
        return res.status(409).json({
          error: 'Remova as variantes deste pacote antes de convertê-lo',
        });
      }

      const target = await prisma.product.findUnique({ where: { id: targetProductId } });
      if (!target) return res.status(404).json({ error: 'Pacote de destino não encontrado' });

      const variantCount = await prisma.productVariant.count({
        where: { productId: targetProductId },
      });

      const variant = await prisma.$transaction(async (tx) => {
        const created = await tx.productVariant.create({
          data: {
            productId: targetProductId,
            name: source.name,
            description: source.description,
            price: source.price,
            comparePrice: source.comparePrice,
            imageUrl: source.imageUrl,
            gallery: source.gallery ?? [],
            stockQuantity: source.stockQuantity,
            minPurchaseQuantity: source.minPurchaseQuantity,
            maxPurchaseQuantity: source.maxPurchaseQuantity,
            onePurchasePerUser: source.onePurchasePerUser,
            isVisible: source.isVisible,
            isActive: source.isActive,
            sortOrder: variantCount,
            deliveryType: source.deliveryType,
            digitalLines: source.digitalLines ?? [],
            digitalFileUrl: source.digitalFileUrl,
            manualDeliveryNote: source.manualDeliveryNote,
            postPurchaseInstructions: source.postPurchaseInstructions,
          },
        });

        await tx.productCode.updateMany({
          where: { productId: sourceId },
          data: { productId: targetProductId, variantId: created.id },
        });

        if (created.deliveryType === 'automatic_lines') {
          const { availableCount } = await syncDigitalStock(tx, {
            productId: targetProductId,
            variantId: created.id,
            digitalLines: created.digitalLines ?? [],
          });
          await tx.productVariant.update({
            where: { id: created.id },
            data: { stockQuantity: availableCount },
          });
        }

        await tx.product.delete({ where: { id: sourceId } });

        return created;
      });

      return res.status(201).json({ variant, targetProductId });
    } catch (err) {
      console.error('[ProductAdmin.convertToVariant]', err);
      return res.status(500).json({ error: 'Erro ao converter pacote em variante' });
    }
  }

  async bulkActions(req, res) {
    try {
      const action = sanitizeString(req.body?.action || '', 40);
      const applyToRaw = ['products', 'variants', 'both'].includes(req.body?.applyTo)
        ? req.body.applyTo
        : req.body?.includeVariants === false
          ? 'products'
          : 'both';
      const updateProducts = applyToRaw === 'products' || applyToRaw === 'both';
      const updateVariants = applyToRaw === 'variants' || applyToRaw === 'both';

      const ids = await resolveBulkProductIds(req.body?.productIds);
      if (!ids.length) {
        return res.status(400).json({ error: 'Nenhum produto encontrado para a ação' });
      }

      if (action === 'visibility') {
        const isVisible = Boolean(req.body?.isVisible);

        const result = await prisma.$transaction(async (tx) => {
          let products = { count: 0 };
          if (updateProducts) {
            products = await tx.product.updateMany({
              where: { id: { in: ids } },
              data: { isVisible },
            });
          }

          let variants = { count: 0 };
          if (updateVariants) {
            variants = await tx.productVariant.updateMany({
              where: { productId: { in: ids } },
              data: { isVisible },
            });
          }

          return { products: products.count, variants: variants.count };
        });

        return res.json({
          success: true,
          updatedProducts: result.products,
          updatedVariants: result.variants,
          applyTo: applyToRaw,
        });
      }

      if (action === 'price') {
        const targetField = req.body?.targetField === 'comparePrice' ? 'comparePrice' : 'price';
        const mode = ['fixed', 'increase_percent', 'decrease_percent'].includes(req.body?.mode)
          ? req.body.mode
          : null;
        const value = Number(req.body?.value);
        const alsoApplyToComparePrice = Boolean(req.body?.alsoApplyToComparePrice);

        if (!mode) {
          return res.status(400).json({ error: 'Modo de alteração inválido' });
        }
        if (!Number.isFinite(value) || value < 0) {
          return res.status(400).json({ error: 'Valor inválido' });
        }
        if (mode !== 'fixed' && value > 1000) {
          return res.status(400).json({ error: 'Porcentagem máxima: 1000%' });
        }

        const [products, variants] = await Promise.all([
          updateProducts
            ? prisma.product.findMany({
                where: { id: { in: ids } },
                select: { id: true, price: true, comparePrice: true },
              })
            : Promise.resolve([]),
          updateVariants
            ? prisma.productVariant.findMany({
                where: { productId: { in: ids } },
                select: { id: true, price: true, comparePrice: true },
              })
            : Promise.resolve([]),
        ]);

        let updatedProducts = 0;
        let updatedVariants = 0;

        await prisma.$transaction(async (tx) => {
          for (const product of products) {
            const data = {};
            const priceBase = Number(product.price) || 0;
            const compareBase = Number(product.comparePrice) || priceBase;

            if (targetField === 'price') {
              const nextPrice = computeAdjustedPrice(priceBase, mode, value);
              if (nextPrice != null) data.price = nextPrice;
              if (alsoApplyToComparePrice) {
                const nextCompare = computeAdjustedPrice(compareBase, mode, value);
                if (nextCompare != null) data.comparePrice = nextCompare;
              }
            } else {
              const nextCompare = computeAdjustedPrice(compareBase, mode, value);
              if (nextCompare != null) data.comparePrice = nextCompare;
            }

            if (Object.keys(data).length) {
              await tx.product.update({ where: { id: product.id }, data });
              updatedProducts += 1;
            }
          }

          for (const variant of variants) {
            const data = {};
            const priceBase = Number(variant.price) || 0;
            const compareBase = Number(variant.comparePrice) || priceBase;

            if (targetField === 'price') {
              const nextPrice = computeAdjustedPrice(priceBase, mode, value);
              if (nextPrice != null) data.price = nextPrice;
              if (alsoApplyToComparePrice) {
                const nextCompare = computeAdjustedPrice(compareBase, mode, value);
                if (nextCompare != null) data.comparePrice = nextCompare;
              }
            } else {
              const nextCompare = computeAdjustedPrice(compareBase, mode, value);
              if (nextCompare != null) data.comparePrice = nextCompare;
            }

            if (Object.keys(data).length) {
              await tx.productVariant.update({ where: { id: variant.id }, data });
              updatedVariants += 1;
            }
          }
        });

        return res.json({
          success: true,
          updatedProducts,
          updatedVariants,
          applyTo: applyToRaw,
        });
      }

      return res.status(400).json({ error: 'Ação em massa inválida' });
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[ProductAdmin.bulkActions]', err);
      return res.status(500).json({ error: 'Erro ao executar ação em massa' });
    }
  }
}

module.exports = new ProductAdminController();
