const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');
const { generateVariantId } = require('../utils/idGenerators');
const {
  syncDigitalStock,
  ensureDigitalStockSynced,
} = require('../utils/digitalStock');
const {
  recordAdminAction,
  AUDIT_ACTIONS,
  requestContext,
  buildPriceChangeMetadata,
} = require('../services/auditLog.service');

function parseDecimal(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function buildData(body, productId) {
  const {
    name, sku, description, price, comparePrice,
    imageUrl, gallery,
    stockQuantity, minPurchaseQuantity, maxPurchaseQuantity, onePurchasePerUser,
    isVisible, isActive, sortOrder,
    deliveryType, digitalLines, digitalFileUrl, manualDeliveryNote, postPurchaseInstructions,
  } = body;

  return {
    ...(productId !== undefined && { productId }),
    ...(name !== undefined && { name: name.trim() }),
    ...(sku !== undefined && { sku: sku ? String(sku).trim().slice(0, 64) : null }),
    ...(description !== undefined && { description }),
    ...(price !== undefined && { price: parseFloat(price) }),
    ...(comparePrice !== undefined && { comparePrice: parseDecimal(comparePrice) }),
    ...(imageUrl !== undefined && { imageUrl: imageUrl || null }),
    ...(gallery !== undefined && { gallery: Array.isArray(gallery) ? gallery : [] }),
    ...(stockQuantity !== undefined && { stockQuantity: parseInt(stockQuantity, 10) || 0 }),
    ...(minPurchaseQuantity !== undefined && { minPurchaseQuantity: parseInt(minPurchaseQuantity, 10) || 1 }),
    ...(maxPurchaseQuantity !== undefined && { maxPurchaseQuantity: maxPurchaseQuantity !== null && maxPurchaseQuantity !== "" ? parseInt(maxPurchaseQuantity, 10) : null }),
    ...(onePurchasePerUser !== undefined && { onePurchasePerUser: Boolean(onePurchasePerUser) }),
    ...(isVisible !== undefined && { isVisible: Boolean(isVisible) }),
    ...(isActive !== undefined && { isActive: Boolean(isActive) }),
    ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder, 10) || 0 }),
    ...(deliveryType !== undefined && { deliveryType }),
    ...(digitalLines !== undefined && { digitalLines: Array.isArray(digitalLines) ? digitalLines : [] }),
    ...(digitalFileUrl !== undefined && { digitalFileUrl: digitalFileUrl || null }),
    ...(manualDeliveryNote !== undefined && { manualDeliveryNote: manualDeliveryNote || null }),
    ...(postPurchaseInstructions !== undefined && { postPurchaseInstructions }),
  };
}

const ProductVariantController = {
  async list(req, res) {
    try {
      const { productId } = req.params;
      const variants = await prisma.productVariant.findMany({
        where: { productId },
        orderBy: { sortOrder: "asc" },
      });

      const enriched = await Promise.all(
        variants.map(async (variant) => {
          if (variant.deliveryType !== 'automatic_lines') return variant;
          const availableCount = await ensureDigitalStockSynced(prisma, variant);
          return { ...variant, stockQuantity: availableCount };
        })
      );

      return res.json({ variants: enriched });
    } catch (err) {
      console.error("[ProductVariant.list]", err);
      return res.status(500).json({ error: "Erro ao listar variantes" });
    }
  },

  async get(req, res) {
    try {
      const { variantId } = req.params;
      const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
      if (!variant) return res.status(404).json({ error: "Variante não encontrada" });
      return res.json(variant);
    } catch (err) {
      console.error("[ProductVariant.get]", err);
      return res.status(500).json({ error: "Erro ao buscar variante" });
    }
  },

  async create(req, res) {
    try {
      const { productId } = req.params;
      const { name, price } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Nome da variante é obrigatório" });
      }
      if (price === undefined || price === null || price === "") {
        return res.status(400).json({ error: "Preço da variante é obrigatório" });
      }

      const count = await prisma.productVariant.count({ where: { productId } });
      const data = buildData(req.body, productId);
      if (data.sortOrder === undefined) data.sortOrder = count;

      const variant = await prisma.$transaction(async (tx) => {
        const created = await tx.productVariant.create({ data });

        if (created.deliveryType === 'automatic_lines') {
          const { availableCount } = await syncDigitalStock(tx, {
            productId,
            variantId: created.id,
            digitalLines: created.digitalLines ?? [],
          });
          return tx.productVariant.update({
            where: { id: created.id },
            data: { stockQuantity: availableCount },
          });
        }

        return created;
      });

      return res.status(201).json(variant);
    } catch (err) {
      console.error("[ProductVariant.create]", err);
      return res.status(500).json({ error: "Erro ao criar variante" });
    }
  },

  async update(req, res) {
    try {
      const { variantId } = req.params;
      const existing = await prisma.productVariant.findUnique({
        where: { id: variantId },
        include: { product: { select: { id: true, name: true } } },
      });

      if (!existing) {
        return res.status(404).json({ error: "Variante não encontrada" });
      }

      const data = buildData(req.body, undefined);

      const variant = await prisma.$transaction(async (tx) => {
        const updated = await tx.productVariant.update({
          where: { id: variantId },
          data,
        });

        if (updated.deliveryType === 'automatic_lines') {
          const { availableCount } = await syncDigitalStock(tx, {
            productId: updated.productId,
            variantId: updated.id,
            digitalLines: updated.digitalLines ?? [],
          });
          return tx.productVariant.update({
            where: { id: updated.id },
            data: { stockQuantity: availableCount },
          });
        }

        return updated;
      });

      const priceMetadata = buildPriceChangeMetadata(
        existing,
        {
          price: variant.price,
          comparePrice: variant.comparePrice,
        },
        {
          productId: existing.productId,
          productName: existing.product.name,
          variantName: existing.name,
        }
      );

      if (priceMetadata) {
        await recordAdminAction({
          ...requestContext(req),
          action: AUDIT_ACTIONS.VARIANT_PRICE_CHANGE,
          targetType: 'variant',
          targetId: variantId,
          metadata: priceMetadata,
        });
      }

      return res.json(variant);
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ error: "Variante não encontrada" });
      }
      console.error("[ProductVariant.update]", err);
      return res.status(500).json({ error: "Erro ao atualizar variante" });
    }
  },

  async remove(req, res) {
    try {
      const { variantId } = req.params;
      await prisma.productVariant.delete({ where: { id: variantId } });
      return res.status(204).send();
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ error: "Variante não encontrada" });
      }
      console.error("[ProductVariant.remove]", err);
      return res.status(500).json({ error: "Erro ao excluir variante" });
    }
  },

  async reorder(req, res) {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "items deve ser um array" });
      }
      await Promise.all(
        items.map(({ id, sortOrder }) =>
          prisma.productVariant.update({ where: { id }, data: { sortOrder } })
        )
      );
      return res.json({ success: true });
    } catch (err) {
      console.error("[ProductVariant.reorder]", err);
      return res.status(500).json({ error: "Erro ao reordenar variantes" });
    }
  },

  async bulkGenerate(req, res) {
    try {
      const { productId } = req.params;
      const { variants: items, defaults = {} } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Informe ao menos uma variante para gerar' });
      }
      if (items.length > 50) {
        return res.status(400).json({ error: 'Máximo de 50 variantes por geração' });
      }

      const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
      if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

      const existing = await prisma.productVariant.findMany({
        where: { productId },
        select: { name: true },
      });
      const existingNames = new Set(existing.map((v) => v.name.trim().toLowerCase()));

      const baseDefaults = {
        deliveryType: 'automatic_lines',
        digitalLines: [],
        stockQuantity: 0,
        minPurchaseQuantity: 1,
        isVisible: true,
        isActive: true,
        onePurchasePerUser: false,
        ...defaults,
      };

      const toCreate = [];
      const skipped = [];

      for (const item of items) {
        const name = String(item.name || '').trim();
        const price = parseFloat(item.price);
        if (!name) {
          return res.status(400).json({ error: 'Todas as variantes precisam de nome' });
        }
        if (Number.isNaN(price) || price <= 0) {
          return res.status(400).json({ error: `Preço inválido para "${name}"` });
        }
        if (existingNames.has(name.toLowerCase())) {
          skipped.push(name);
          continue;
        }
        existingNames.add(name.toLowerCase());
        const requestedStock = parseInt(item.stockQuantity, 10) || 0;
        const hasLines = Array.isArray(item.digitalLines) && item.digitalLines.length > 0;
        const deliveryType =
          !hasLines && requestedStock > 0 ? 'manual' : (item.deliveryType || baseDefaults.deliveryType);

        toCreate.push({
          ...baseDefaults,
          ...item,
          name,
          price,
          comparePrice: parseDecimal(item.comparePrice),
          stockQuantity: requestedStock,
          deliveryType,
        });
      }

      if (toCreate.length === 0) {
        return res.status(400).json({
          error: skipped.length
            ? 'Todas as combinações já existem neste produto'
            : 'Nenhuma variante válida para criar',
          skipped,
        });
      }

      const count = await prisma.productVariant.count({ where: { productId } });

      const created = await prisma.$transaction(async (tx) => {
        const results = [];
        let nextVariantId = Number(await generateVariantId(tx));

        for (let i = 0; i < toCreate.length; i += 1) {
          const item = toCreate[i];
          const data = buildData(item, productId);
          data.id = String(nextVariantId);
          nextVariantId += 1;
          data.sortOrder = count + i;
          if (!data.deliveryType) data.deliveryType = 'automatic_lines';
          if (!Array.isArray(data.digitalLines)) data.digitalLines = [];

          const variant = await tx.productVariant.create({ data });

          if (variant.deliveryType === 'automatic_lines') {
            const { availableCount } = await syncDigitalStock(tx, {
              productId,
              variantId: variant.id,
              digitalLines: variant.digitalLines ?? [],
            });
            results.push(
              await tx.productVariant.update({
                where: { id: variant.id },
                data: { stockQuantity: availableCount },
              })
            );
          } else {
            results.push(variant);
          }
        }
        return results;
      });

      return res.status(201).json({
        variants: created,
        created: created.length,
        skipped,
      });
    } catch (err) {
      console.error('[ProductVariant.bulkGenerate]', err);
      return res.status(500).json({ error: 'Erro ao gerar variantes' });
    }
  },

  async duplicate(req, res) {
    try {
      const { productId, variantId } = req.params;
      const source = await prisma.productVariant.findFirst({
        where: { id: variantId, productId },
      });
      if (!source) return res.status(404).json({ error: 'Variante não encontrada' });

      const count = await prisma.productVariant.count({ where: { productId } });
      const variant = await prisma.$transaction(async (tx) => {
        const created = await tx.productVariant.create({
          data: {
            productId,
            sku: source.sku ? `${source.sku}-copia` : null,
            name: `${source.name} (cópia)`,
            description: source.description,
            price: source.price,
            comparePrice: source.comparePrice,
            imageUrl: source.imageUrl,
            gallery: source.gallery ?? [],
            stockQuantity: 0,
            minPurchaseQuantity: source.minPurchaseQuantity,
            maxPurchaseQuantity: source.maxPurchaseQuantity,
            onePurchasePerUser: source.onePurchasePerUser,
            isVisible: source.isVisible,
            isActive: source.isActive,
            sortOrder: count,
            deliveryType: source.deliveryType,
            digitalLines: source.digitalLines ?? [],
            digitalFileUrl: source.digitalFileUrl,
            manualDeliveryNote: source.manualDeliveryNote,
            postPurchaseInstructions: source.postPurchaseInstructions,
          },
        });

        if (created.deliveryType === 'automatic_lines') {
          const { availableCount } = await syncDigitalStock(tx, {
            productId,
            variantId: created.id,
            digitalLines: created.digitalLines ?? [],
          });
          return tx.productVariant.update({
            where: { id: created.id },
            data: { stockQuantity: availableCount },
          });
        }

        return tx.productVariant.update({
          where: { id: created.id },
          data: { stockQuantity: source.stockQuantity },
        });
      });

      return res.status(201).json(variant);
    } catch (err) {
      console.error('[ProductVariant.duplicate]', err);
      return res.status(500).json({ error: 'Erro ao duplicar variante' });
    }
  },
};

module.exports = ProductVariantController;
