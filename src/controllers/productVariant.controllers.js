const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');

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
      return res.json({ variants });
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

      const variant = await prisma.productVariant.create({ data });
      return res.status(201).json(variant);
    } catch (err) {
      console.error("[ProductVariant.create]", err);
      return res.status(500).json({ error: "Erro ao criar variante" });
    }
  },

  async update(req, res) {
    try {
      const { variantId } = req.params;
      const data = buildData(req.body, undefined);

      const variant = await prisma.productVariant.update({
        where: { id: variantId },
        data,
      });
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

  async duplicate(req, res) {
    try {
      const { productId, variantId } = req.params;
      const source = await prisma.productVariant.findFirst({
        where: { id: variantId, productId },
      });
      if (!source) return res.status(404).json({ error: 'Variante não encontrada' });

      const count = await prisma.productVariant.count({ where: { productId } });
      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: source.sku ? `${source.sku}-copia` : null,
          name: `${source.name} (cópia)`,
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
          sortOrder: count,
          deliveryType: source.deliveryType,
          digitalLines: source.digitalLines ?? [],
          digitalFileUrl: source.digitalFileUrl,
          manualDeliveryNote: source.manualDeliveryNote,
          postPurchaseInstructions: source.postPurchaseInstructions,
        },
      });

      return res.status(201).json(variant);
    } catch (err) {
      console.error('[ProductVariant.duplicate]', err);
      return res.status(500).json({ error: 'Erro ao duplicar variante' });
    }
  },
};

module.exports = ProductVariantController;
