const crypto = require('crypto');

/**
 * IDs numéricos longos para usuários, produtos e categorias.
 * Ex.: 1776740285999274968939028068
 */
function generateNumericId() {
  const time = String(Date.now());
  const random = String(crypto.randomInt(100_000_000, 999_999_999));
  return `${time}${random}`;
}

/**
 * ID hexadecimal de 32 caracteres para pedidos.
 * Ex.: 54d60f1a76ab4abd9fb7213eca1995b8
 */
function generateOrderId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * IDs sequenciais curtos para variantes. Ex.: 100035
 */
async function generateVariantId(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(MAX(CAST("id" AS INTEGER)), 100000) + 1 AS next
    FROM "ProductVariant"
    WHERE "id" ~ '^[0-9]+$'
  `;
  const next = Number(rows?.[0]?.next ?? 100001);
  return String(next);
}

module.exports = {
  generateNumericId,
  generateOrderId,
  generateVariantId,
};
