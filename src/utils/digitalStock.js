/**
 * Estoque digital: sincroniza digitalLines (admin) com ProductCode (checkout/entrega).
 */

function normalizeLines(digitalLines) {
  if (!Array.isArray(digitalLines)) return [];
  return [
    ...new Set(
      digitalLines
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
    ),
  ];
}

function stockScope(productId, variantId = null) {
  return { productId, variantId: variantId ?? null };
}

async function getAvailableStockCount(tx, productId, variantId = null) {
  return tx.productCode.count({
    where: { ...stockScope(productId, variantId), status: 'AVAILABLE' },
  });
}

/**
 * Sincroniza linhas do admin com registros ProductCode disponíveis.
 * Códigos já entregues (DELIVERED) são preservados.
 */
async function syncDigitalStock(tx, { productId, variantId = null, digitalLines = [] }) {
  const lines = normalizeLines(digitalLines);
  const scope = stockScope(productId, variantId);

  const existing = await tx.productCode.findMany({ where: scope });
  const existingByCode = new Map(existing.map((c) => [c.code, c]));
  const lineSet = new Set(lines);

  const toCreate = lines.filter((line) => !existingByCode.has(line));
  if (toCreate.length) {
    await tx.productCode.createMany({
      data: toCreate.map((code) => ({
        productId,
        variantId: variantId ?? null,
        code,
      })),
      skipDuplicates: true,
    });
  }

  const toDeleteIds = existing
    .filter((c) => c.status === 'AVAILABLE' && !lineSet.has(c.code))
    .map((c) => c.id);

  if (toDeleteIds.length) {
    await tx.productCode.deleteMany({ where: { id: { in: toDeleteIds } } });
  }

  const availableCount = await getAvailableStockCount(tx, productId, variantId);
  return { availableCount, lines };
}

async function applyAutomaticStockQuantity(tx, { productId, variantId = null, availableCount }) {
  const qty = availableCount ?? 0;
  if (variantId) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { stockQuantity: qty },
    });
  } else {
    await tx.product.update({
      where: { id: productId },
      data: { stockQuantity: qty },
    });
  }
  return qty;
}

/**
 * Garante que digitalLines existentes foram materializadas em ProductCode.
 * Útil para dados legados e para leitura na loja sem re-salvar no admin.
 */
async function ensureDigitalStockSynced(tx, entity) {
  if (entity.deliveryType !== 'automatic_lines') {
    return entity.stockQuantity ?? 0;
  }

  const productId = entity.productId ?? entity.id;
  const variantId = entity.productId ? entity.id : null;
  const lines = entity.digitalLines || [];

  const availableCount = await getAvailableStockCount(tx, productId, variantId);

  if (lines.length > 0 && availableCount < lines.length) {
    const synced = await syncDigitalStock(tx, { productId, variantId, digitalLines: lines });
    await applyAutomaticStockQuantity(tx, { productId, variantId, availableCount: synced.availableCount });
    return synced.availableCount;
  }

  if (availableCount !== (entity.stockQuantity ?? 0)) {
    await applyAutomaticStockQuantity(tx, { productId, variantId, availableCount });
  }

  return availableCount;
}

function resolveDisplayStock(entity, availableCodeCount = null) {
  if (entity.deliveryType === 'automatic_lines') {
    if (availableCodeCount !== null) return availableCodeCount;
    if (Array.isArray(entity.digitalLines) && entity.digitalLines.length > 0) {
      return entity.digitalLines.length;
    }
    return entity.stockQuantity ?? 0;
  }
  return entity.stockQuantity ?? 0;
}

function validateStockQuantity(entity, quantity, availableCodeCount) {
  const qty = Math.max(1, Number(quantity) || 1);
  const isVariant = Boolean(entity.productId);

  if (entity.deliveryType === 'automatic_lines') {
    if (availableCodeCount < qty) {
      throw new Error(
        isVariant
          ? 'Esta variante está sem estoque no momento'
          : 'Este produto está sem estoque no momento'
      );
    }
    return;
  }

  const manualStock = entity.stockQuantity ?? 0;
  if (manualStock > 0 && qty > manualStock) {
    throw new Error('Quantidade indisponível no estoque');
  }
}

async function syncAutomaticStockFromCodes(tx, productId, variantId = null) {
  const availableCount = await getAvailableStockCount(tx, productId, variantId);
  await applyAutomaticStockQuantity(tx, { productId, variantId, availableCount });
  return availableCount;
}

module.exports = {
  normalizeLines,
  getAvailableStockCount,
  syncDigitalStock,
  applyAutomaticStockQuantity,
  ensureDigitalStockSynced,
  syncAutomaticStockFromCodes,
  resolveDisplayStock,
  validateStockQuantity,
};
