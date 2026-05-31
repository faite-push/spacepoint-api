const { prisma } = require('../config/prisma');
const { sanitizeString, sanitizeSlug } = require('../utils/sanitize');

const DELIVERY_TYPES = ['automatic_lines', 'file', 'manual_chat', 'mixed'];

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

      const created = await prisma.product.create({
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

      const updated = await prisma.product.update({
        where: { id },
        data,
        include: {
          category: { select: { id: true, name: true, slug: true } },
        },
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

        await tx.product.delete({ where: { id: sourceId } });

        return created;
      });

      return res.status(201).json({ variant, targetProductId });
    } catch (err) {
      console.error('[ProductAdmin.convertToVariant]', err);
      return res.status(500).json({ error: 'Erro ao converter pacote em variante' });
    }
  }
}

module.exports = new ProductAdminController();
