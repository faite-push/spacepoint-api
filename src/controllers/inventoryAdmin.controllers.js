const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');
const {
  normalizeLines,
  syncDigitalStock,
  syncAutomaticStockFromCodes,
  ensureDigitalStockSynced,
} = require('../utils/digitalStock');

const LOW_STOCK_THRESHOLD = 10;
const MAX_BULK_LINES = 5000;
const MAX_CODES_PAGE_SIZE = 100;

function maskCode(code) {
  const value = String(code || '');
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function resolveAvailableStock(variant, codeCounts) {
  if (variant.deliveryType === 'automatic_lines' || variant.deliveryType === 'mixed') {
    return codeCounts.AVAILABLE ?? 0;
  }
  return variant.stockQuantity ?? 0;
}

function resolveStockStatus(available) {
  if (available <= 0) return 'out';
  if (available < LOW_STOCK_THRESHOLD) return 'low';
  return 'ok';
}

function buildVariantSearchFilter(search) {
  const term = sanitizeString(search || '', 120);
  if (!term) return {};

  return {
    OR: [
      { name: { contains: term, mode: 'insensitive' } },
      { sku: { contains: term, mode: 'insensitive' } },
      { product: { name: { contains: term, mode: 'insensitive' } } },
      { product: { slug: { contains: term, mode: 'insensitive' } } },
    ],
  };
}

class InventoryAdminController {
  async list(req, res) {
    try {
      const search = sanitizeString(req.query.search || '', 120);
      const status = sanitizeString(req.query.status || 'all', 20);
      const deliveryType = sanitizeString(req.query.deliveryType || '', 40);
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));

      const where = {
        isActive: true,
        product: { isActive: true },
        ...buildVariantSearchFilter(search),
      };

      if (deliveryType && deliveryType !== 'all') {
        where.deliveryType = deliveryType;
      }

      const variants = await prisma.productVariant.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              category: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [
          { product: { name: 'asc' } },
          { sortOrder: 'asc' },
        ],
      });

      const variantIds = variants.map((v) => v.id);
      const codeGroups = variantIds.length
        ? await prisma.productCode.groupBy({
          by: ['variantId', 'status'],
          where: { variantId: { in: variantIds } },
          _count: { _all: true },
        })
        : [];

      const countsByVariant = new Map();
      for (const row of codeGroups) {
        if (!row.variantId) continue;
        const bucket = countsByVariant.get(row.variantId) || {
          AVAILABLE: 0,
          RESERVED: 0,
          DELIVERED: 0,
        };
        bucket[row.status] = row._count._all;
        countsByVariant.set(row.variantId, bucket);
      }

      let items = await Promise.all(
        variants.map(async (variant) => {
          const codeCounts = countsByVariant.get(variant.id) || {
            AVAILABLE: 0,
            RESERVED: 0,
            DELIVERED: 0,
          };

          let available = resolveAvailableStock(variant, codeCounts);

          if (variant.deliveryType === 'automatic_lines') {
            available = await ensureDigitalStockSynced(prisma, variant);
          }

          const stockStatus = resolveStockStatus(available);

          return {
            id: variant.id,
            productId: variant.productId,
            productName: variant.product.name,
            productSlug: variant.product.slug,
            categoryName: variant.product.category?.name || null,
            name: variant.name,
            sku: variant.sku,
            deliveryType: variant.deliveryType,
            isVisible: variant.isVisible,
            available,
            reserved: codeCounts.RESERVED,
            delivered: codeCounts.DELIVERED,
            totalCodes: codeCounts.AVAILABLE + codeCounts.RESERVED + codeCounts.DELIVERED,
            stockStatus,
          };
        })
      );

      if (status === 'low') {
        items = items.filter((item) => item.stockStatus === 'low');
      } else if (status === 'out') {
        items = items.filter((item) => item.stockStatus === 'out');
      } else if (status === 'ok') {
        items = items.filter((item) => item.stockStatus === 'ok');
      }

      const summary = {
        totalVariants: items.length,
        lowStock: items.filter((i) => i.stockStatus === 'low').length,
        outOfStock: items.filter((i) => i.stockStatus === 'out').length,
        inStock: items.filter((i) => i.stockStatus === 'ok').length,
      };

      const total = items.length;
      const start = (page - 1) * pageSize;
      const paginated = items.slice(start, start + pageSize);

      return res.json({
        items: paginated,
        summary,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (err) {
      console.error('[InventoryAdmin.list]', err);
      return res.status(500).json({ error: 'Erro ao listar inventário' });
    }
  }

  async listCodes(req, res) {
    try {
      const { variantId } = req.params;
      const status = sanitizeString(req.query.status || 'AVAILABLE', 20).toUpperCase();
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(MAX_CODES_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 50));

      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
        include: {
          product: { select: { id: true, name: true } },
        },
      });

      if (!variant) return res.status(404).json({ error: 'Variante não encontrada' });

      const where = { variantId };
      if (status !== 'ALL') where.status = status;

      const [total, codes] = await Promise.all([
        prisma.productCode.count({ where }),
        prisma.productCode.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            code: true,
            status: true,
            createdAt: true,
            deliveredAt: true,
            orderItemId: true,
          },
        }),
      ]);

      return res.json({
        variant: {
          id: variant.id,
          name: variant.name,
          sku: variant.sku,
          deliveryType: variant.deliveryType,
          productId: variant.productId,
          productName: variant.product.name,
        },
        codes: codes.map((row) => ({
          ...row,
          maskedCode: maskCode(row.code),
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (err) {
      console.error('[InventoryAdmin.listCodes]', err);
      return res.status(500).json({ error: 'Erro ao listar códigos' });
    }
  }

  async bulkUploadCodes(req, res) {
    try {
      const { variantId } = req.params;
      const rawLines = Array.isArray(req.body?.lines)
        ? req.body.lines
        : String(req.body?.content || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

      const lines = normalizeLines(rawLines);

      if (!lines.length) {
        return res.status(400).json({ error: 'Informe ao menos uma linha/código' });
      }
      if (lines.length > MAX_BULK_LINES) {
        return res.status(400).json({ error: `Máximo de ${MAX_BULK_LINES} linhas por upload` });
      }

      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
        select: {
          id: true,
          productId: true,
          deliveryType: true,
          digitalLines: true,
          stockQuantity: true,
        },
      });

      if (!variant) return res.status(404).json({ error: 'Variante não encontrada' });

      if (!['automatic_lines', 'mixed'].includes(variant.deliveryType)) {
        return res.status(400).json({
          error: 'Upload em massa disponível apenas para variantes com entrega automática por linhas',
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.productCode.findMany({
          where: {
            variantId: variant.id,
            code: { in: lines },
          },
          select: { code: true },
        });
        const existingSet = new Set(existing.map((row) => row.code));
        const newLines = lines.filter((line) => !existingSet.has(line));
        const mergedLines = [...new Set([...(variant.digitalLines || []), ...lines])];

        await tx.productVariant.update({
          where: { id: variant.id },
          data: { digitalLines: mergedLines },
        });

        await syncDigitalStock(tx, {
          productId: variant.productId,
          variantId: variant.id,
          digitalLines: mergedLines,
        });

        const available = await syncAutomaticStockFromCodes(tx, variant.productId, variant.id);

        return {
          added: newLines.length,
          duplicates: lines.length - newLines.length,
          available,
          totalLines: mergedLines.length,
        };
      });

      return res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      console.error('[InventoryAdmin.bulkUploadCodes]', err);
      return res.status(400).json({ error: err.message || 'Erro ao adicionar códigos' });
    }
  }

  async updateManualStock(req, res) {
    try {
      const { variantId } = req.params;
      const stockQuantity = Number(req.body?.stockQuantity);

      if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
        return res.status(400).json({ error: 'Quantidade inválida' });
      }

      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { id: true, deliveryType: true },
      });

      if (!variant) return res.status(404).json({ error: 'Variante não encontrada' });

      if (['automatic_lines'].includes(variant.deliveryType)) {
        return res.status(400).json({
          error: 'Para variantes automáticas, adicione códigos pelo upload em massa',
        });
      }

      const updated = await prisma.productVariant.update({
        where: { id: variantId },
        data: { stockQuantity: Math.floor(stockQuantity) },
        select: {
          id: true,
          stockQuantity: true,
          deliveryType: true,
        },
      });

      return res.json({ success: true, variant: updated });
    } catch (err) {
      console.error('[InventoryAdmin.updateManualStock]', err);
      return res.status(400).json({ error: err.message || 'Erro ao atualizar estoque' });
    }
  }

  async removeCode(req, res) {
    try {
      const { codeId } = req.params;

      const code = await prisma.productCode.findUnique({
        where: { id: codeId },
        include: {
          variant: {
            select: { id: true, productId: true, digitalLines: true, deliveryType: true },
          },
        },
      });

      if (!code) return res.status(404).json({ error: 'Código não encontrado' });
      if (code.status !== 'AVAILABLE') {
        return res.status(400).json({ error: 'Somente códigos disponíveis podem ser removidos' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.productCode.delete({ where: { id: codeId } });

        if (code.variant) {
          const nextLines = (code.variant.digitalLines || []).filter((line) => line !== code.code);
          await tx.productVariant.update({
            where: { id: code.variant.id },
            data: { digitalLines: nextLines },
          });
          await syncAutomaticStockFromCodes(tx, code.variant.productId, code.variant.id);
        }
      });

      return res.json({ success: true });
    } catch (err) {
      console.error('[InventoryAdmin.removeCode]', err);
      return res.status(400).json({ error: err.message || 'Erro ao remover código' });
    }
  }
}

module.exports = new InventoryAdminController();
