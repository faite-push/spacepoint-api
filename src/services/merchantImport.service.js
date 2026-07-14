const { XMLParser } = require('fast-xml-parser');
const { prisma } = require('../config/prisma');
const { sanitizeString, sanitizeSlug } = require('../utils/sanitize');
const { generateVariantId } = require('../utils/idGenerators');

const MAX_XML_CHARS = 12 * 1024 * 1024;
const MAX_PRODUCTS = 2000;

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (typeof value['#text'] === 'string') return cleanText(value['#text']);
    if (typeof value.__cdata === 'string') return cleanText(value.__cdata);
    return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function parseMoney(value) {
  const text = cleanText(value).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = Number.parseFloat(text);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function textToTiptap(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;

  const chunks = cleaned
    .split(/(?<=\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 40);

  const paragraphs = chunks.length ? chunks : [cleaned];

  return {
    type: 'doc',
    content: paragraphs.map((paragraph) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: paragraph.slice(0, 4000) }],
    })),
  };
}

function parseProductTypePath(raw) {
  const text = cleanText(raw);
  if (!text) return null;

  const parts = text
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return null;

  const parentName = parts[0].slice(0, 80);
  const childName = parts[1] ? parts[1].slice(0, 80) : null;

  if (/^sem categoria$/i.test(parentName) && !childName) {
    return null;
  }

  return { parentName, childName };
}

function extractVariantLabel(skuOrId, title) {
  const source = `${skuOrId || ''} ${title || ''}`.toLowerCase();
  const match = source.match(
    /(prim[aá]ria|secund[aá]ria|primary|secondary)[-_\s]*(ps\s*[45]|playstation\s*[45])?/i
  );

  if (!match) {
    const sku = cleanText(skuOrId);
    return sku ? sku.slice(0, 60) : 'Padrão';
  }

  const licenseRaw = match[1]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const license =
    licenseRaw.startsWith('prim') || licenseRaw === 'primary'
      ? 'PRIMÁRIA'
      : 'SECUNDÁRIA';

  const platformRaw = (match[2] || '').replace(/\s+/g, '').toUpperCase();
  const platform = platformRaw
    .replace('PLAYSTATION5', 'PS5')
    .replace('PLAYSTATION4', 'PS4')
    .replace(/^PS/, 'PS');

  return platform ? `${license} ${platform}` : license;
}

function detectPlatform(brand, productTypes, title) {
  const haystack = `${brand || ''} ${(productTypes || []).join(' ')} ${title || ''}`.toUpperCase();
  const hasPs4 = /PS\s*4|PLAYSTATION\s*4/.test(haystack);
  const hasPs5 = /PS\s*5|PLAYSTATION\s*5/.test(haystack);
  if (hasPs4 && hasPs5) return 'PS4/PS5';
  if (hasPs5) return 'PS5';
  if (hasPs4) return 'PS4';
  const brandClean = cleanText(brand);
  return brandClean ? brandClean.slice(0, 40) : 'PlayStation';
}

function normalizeItem(rawItem) {
  const title = cleanText(rawItem.title || rawItem['g:title']);
  const description = cleanText(rawItem.description || rawItem['g:description']);
  const link = cleanText(rawItem.link || rawItem['g:link']);
  const imageLink = cleanText(rawItem['g:image_link'] || rawItem.image_link);
  const additionalImages = asArray(rawItem['g:additional_image_link'] || rawItem.additional_image_link)
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 10);

  const listPrice = parseMoney(rawItem['g:price'] || rawItem.price);
  const salePrice = parseMoney(rawItem['g:sale_price'] || rawItem.sale_price);
  const price = salePrice ?? listPrice;
  const comparePrice =
    listPrice != null && price != null && listPrice > price ? listPrice : null;

  const id = cleanText(rawItem['g:id'] || rawItem.id);
  const itemGroupId = cleanText(rawItem['g:item_group_id'] || rawItem.item_group_id) || null;
  const brand = cleanText(rawItem['g:brand'] || rawItem.brand);
  const availability = cleanText(rawItem['g:availability'] || rawItem.availability).toLowerCase();
  const inStock = !availability || availability.includes('in stock') || availability === 'instock';

  const productTypes = asArray(rawItem['g:product_type'] || rawItem.product_type)
    .map(cleanText)
    .filter(Boolean);

  if (!title || price == null) return null;

  return {
    id,
    itemGroupId,
    title: title.slice(0, 120),
    description,
    link,
    imageUrl: imageLink ? imageLink.slice(0, 500) : null,
    gallery: additionalImages.map((url) => url.slice(0, 500)),
    price,
    comparePrice,
    brand,
    productTypes,
    inStock,
    variantName: extractVariantLabel(id, title),
  };
}

function groupMerchantItems(items) {
  const groups = new Map();

  for (const item of items) {
    const key = item.itemGroupId || `solo:${item.id || item.title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return [...groups.entries()].map(([groupId, groupItems]) => {
    const first = groupItems[0];
    const prices = groupItems.map((item) => item.price).filter((n) => n != null);
    const comparePrices = groupItems
      .map((item) => item.comparePrice ?? item.price)
      .filter((n) => n != null);
    const minPrice = Math.min(...prices);
    const maxCompare = Math.max(...comparePrices);
    const productTypes = [...new Set(groupItems.flatMap((item) => item.productTypes))];
    const preferredType =
      productTypes.find((type) => !/^sem categoria$/i.test(cleanText(type).split('>')[0] || '')) ||
      productTypes[0];
    const typePath = parseProductTypePath(preferredType);

    const uniqueVariantNames = new Set(groupItems.map((item) => item.variantName));
    const hasVariants = groupItems.length > 1;

    return {
      groupId,
      name: first.title,
      description: first.description,
      imageUrl: first.imageUrl,
      gallery: first.gallery,
      price: minPrice,
      comparePrice: maxCompare > minPrice ? maxCompare : null,
      platform: detectPlatform(first.brand, productTypes, first.title),
      categoryParent: typePath?.parentName || null,
      categoryChild: typePath?.childName || null,
      inStock: groupItems.some((item) => item.inStock),
      hasVariants,
      variants: hasVariants
        ? groupItems.map((item, index) => ({
            name: uniqueVariantNames.size === groupItems.length
              ? item.variantName
              : `${item.variantName} ${index + 1}`,
            sku: item.id ? item.id.slice(0, 64) : null,
            price: item.price,
            comparePrice: item.comparePrice,
            imageUrl: item.imageUrl,
            inStock: item.inStock,
            sortOrder: index,
          }))
        : [],
    };
  });
}

function parseMerchantXml(xmlText) {
  if (typeof xmlText !== 'string' || !xmlText.trim()) {
    const err = new Error('Arquivo XML vazio');
    err.status = 400;
    throw err;
  }

  if (xmlText.length > MAX_XML_CHARS) {
    const err = new Error('Arquivo XML muito grande (máx. 12 MB)');
    err.status = 400;
    throw err;
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    cdataPropName: '__cdata',
    isArray: (name) =>
      ['item', 'g:product_type', 'g:additional_image_link', 'product_type', 'additional_image_link'].includes(
        name
      ),
  });

  let parsed;
  try {
    parsed = parser.parse(xmlText);
  } catch (error) {
    const err = new Error('XML inválido ou corrompido');
    err.status = 400;
    throw err;
  }

  const channel = parsed?.rss?.channel || parsed?.feed || parsed;
  const rawItems = asArray(channel?.item || channel?.entry);
  if (!rawItems.length) {
    const err = new Error('Nenhum produto encontrado no XML');
    err.status = 400;
    throw err;
  }

  const items = rawItems.map(normalizeItem).filter(Boolean);
  if (!items.length) {
    const err = new Error('Nenhum produto válido encontrado no XML');
    err.status = 400;
    throw err;
  }

  const products = groupMerchantItems(items);
  if (products.length > MAX_PRODUCTS) {
    const err = new Error(`Limite de ${MAX_PRODUCTS} produtos por importação`);
    err.status = 400;
    throw err;
  }

  return {
    itemCount: items.length,
    productCount: products.length,
    variantCount: products.reduce((sum, product) => sum + product.variants.length, 0),
    categoryParents: [...new Set(products.map((p) => p.categoryParent).filter(Boolean))],
    products,
  };
}

async function generateUniqueProductSlug(tx, name, ignoreId = null) {
  const base = sanitizeSlug(name) || 'produto';
  let slug = base;
  let n = 1;
  while (n < 80) {
    const existing = await tx.product.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === ignoreId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

async function generateUniqueCategorySlug(tx, name, ignoreId = null) {
  const base = sanitizeSlug(name) || 'categoria';
  let slug = base;
  let n = 1;
  while (n < 80) {
    const existing = await tx.category.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === ignoreId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

async function ensureCategoryPath(tx, parentName, childName, cache) {
  if (!parentName) return null;

  const parentKey = `root:${parentName.toLowerCase()}`;
  let parentId = cache.ids.get(parentKey);

  if (!parentId) {
    const existingParent = await tx.category.findFirst({
      where: {
        parentId: null,
        name: { equals: parentName, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (existingParent) {
      parentId = existingParent.id;
    } else {
      const createdParent = await tx.category.create({
        data: {
          name: parentName,
          slug: await generateUniqueCategorySlug(tx, parentName),
          parentId: null,
          isActive: true,
          showInNavbar: true,
          showInFooter: false,
          sortOrder: 0,
        },
        select: { id: true },
      });
      parentId = createdParent.id;
      cache.created += 1;
    }
    cache.ids.set(parentKey, parentId);
  }

  if (!childName) return parentId;

  const childKey = `${parentId}:${childName.toLowerCase()}`;
  let childId = cache.ids.get(childKey);
  if (childId) return childId;

  const existingChild = await tx.category.findFirst({
    where: {
      parentId,
      name: { equals: childName, mode: 'insensitive' },
    },
    select: { id: true },
  });

  if (existingChild) {
    cache.ids.set(childKey, existingChild.id);
    return existingChild.id;
  }

  const createdChild = await tx.category.create({
    data: {
      name: childName,
      slug: await generateUniqueCategorySlug(tx, childName),
      parentId,
      isActive: true,
      showInNavbar: false,
      showInFooter: false,
      sortOrder: 0,
    },
    select: { id: true },
  });

  cache.ids.set(childKey, createdChild.id);
  cache.created += 1;
  return createdChild.id;
}

function buildPreview(parsed) {
  const sample = parsed.products.slice(0, 8).map((product) => ({
    name: product.name,
    price: product.price,
    comparePrice: product.comparePrice,
    category: [product.categoryParent, product.categoryChild].filter(Boolean).join(' > '),
    variants: product.variants.map((variant) => variant.name),
    imageUrl: product.imageUrl,
  }));

  return {
    itemCount: parsed.itemCount,
    productCount: parsed.productCount,
    variantCount: parsed.variantCount,
    categoryParents: parsed.categoryParents,
    sample,
  };
}

async function importMerchantXml(xmlText, { dryRun = false, skipExisting = true } = {}) {
  const parsed = parseMerchantXml(xmlText);
  const preview = buildPreview(parsed);

  if (dryRun) {
    return { dryRun: true, ...preview, created: 0, skipped: 0, categoriesCreated: 0 };
  }

  const categoryCache = { ids: new Map(), created: 0 };
  let created = 0;
  let skipped = 0;
  let variantsCreated = 0;
  const errors = [];

  for (const product of parsed.products) {
    try {
      await prisma.$transaction(async (tx) => {
        const baseSlug = sanitizeSlug(product.name) || 'produto';
        const existing = await tx.product.findFirst({
          where: {
            OR: [
              { slug: baseSlug },
              { name: { equals: product.name, mode: 'insensitive' } },
            ],
          },
          select: { id: true, slug: true },
        });

        if (existing && skipExisting) {
          skipped += 1;
          return;
        }

        const categoryId = await ensureCategoryPath(
          tx,
          product.categoryParent,
          product.categoryChild,
          categoryCache
        );

        const stockQuantity = product.inStock ? 10 : 0;
        const slug = existing?.slug || (await generateUniqueProductSlug(tx, product.name));

        let productId = existing?.id || null;

        if (existing && !skipExisting) {
          await tx.product.update({
            where: { id: existing.id },
            data: {
              price: product.price,
              comparePrice: product.comparePrice,
              imageUrl: product.imageUrl,
              gallery: product.gallery,
              platform: product.platform,
              categoryId,
              description: textToTiptap(product.description),
              isVisible: true,
              isActive: true,
            },
          });
          productId = existing.id;
        } else {
          const createdProduct = await tx.product.create({
            data: {
              name: sanitizeString(product.name, 120),
              slug,
              description: textToTiptap(product.description),
              price: product.price,
              comparePrice: product.comparePrice,
              imageUrl: product.imageUrl,
              gallery: product.gallery,
              stockQuantity: product.hasVariants ? 0 : stockQuantity,
              deliveryType: 'manual',
              isVisible: true,
              isActive: true,
              featured: false,
              categoryId,
              platform: product.platform,
              isDigital: true,
              digitalLines: [],
            },
            select: { id: true },
          });
          productId = createdProduct.id;
          created += 1;
        }

        if (!product.hasVariants || !productId) return;

        const existingVariants = await tx.productVariant.findMany({
          where: { productId },
          select: { id: true, sku: true, name: true },
        });

        let nextVariantId = Number(await generateVariantId(tx));

        for (const variant of product.variants) {
          const already =
            existingVariants.find((row) => row.sku && variant.sku && row.sku === variant.sku) ||
            existingVariants.find(
              (row) => row.name.toLowerCase() === String(variant.name).toLowerCase()
            );

          if (already) continue;

          await tx.productVariant.create({
            data: {
              id: String(nextVariantId),
              productId,
              name: sanitizeString(variant.name, 120) || 'Variante',
              sku: variant.sku,
              price: variant.price,
              comparePrice: variant.comparePrice,
              imageUrl: variant.imageUrl,
              stockQuantity: variant.inStock ? 10 : 0,
              deliveryType: 'manual',
              isVisible: true,
              isActive: true,
              sortOrder: variant.sortOrder,
              digitalLines: [],
            },
          });
          nextVariantId += 1;
          variantsCreated += 1;
        }
      }, { timeout: 30000 });
    } catch (error) {
      errors.push({
        product: product.name,
        error: error.message || 'Falha ao importar',
      });
    }
  }

  return {
    dryRun: false,
    ...preview,
    created,
    skipped,
    variantsCreated,
    categoriesCreated: categoryCache.created,
    errors: errors.slice(0, 30),
  };
}

module.exports = {
  parseMerchantXml,
  buildPreview,
  importMerchantXml,
  extractVariantLabel,
  parseProductTypePath,
};
