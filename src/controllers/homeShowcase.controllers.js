const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');
const { mapProductsForStore, visibleVariantWhere } = require('../utils/productStore');

async function ensureLegacyShowcaseSection() {
  const count = await prisma.homeShowcaseSection.count();
  if (count > 0) return;

  const config = await prisma.siteConfig.findUnique({ where: { id: 'default' } });
  const featuredProducts = await prisma.product.findMany({
    where: { isActive: true, isVisible: true, featured: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    select: { id: true },
  });

  if (!featuredProducts.length && !config?.homeShowcaseEnabled) return;

  const section = await prisma.homeShowcaseSection.create({
    data: {
      title: config?.homeShowcaseTitle?.trim() || 'Mais Vendidos',
      subtitle: config?.homeShowcaseSubtitle?.trim() || null,
      enabled: config?.homeShowcaseEnabled !== false,
      sortOrder: 0,
      maxItems: 12,
    },
  });

  if (featuredProducts.length) {
    await prisma.homeShowcaseSectionProduct.createMany({
      data: featuredProducts.map((product, index) => ({
        sectionId: section.id,
        productId: product.id,
        sortOrder: index,
      })),
      skipDuplicates: true,
    });
  }
}

async function loadPublicSections(req) {
  await ensureLegacyShowcaseSection();

  const rows = await prisma.homeShowcaseSection.findMany({
    where: { enabled: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      products: {
        orderBy: { sortOrder: 'asc' },
        include: {
          product: {
            include: {
              variants: { where: visibleVariantWhere(), orderBy: { sortOrder: 'asc' } },
            },
          },
        },
      },
    },
  });

  const sections = [];
  for (const section of rows) {
    const productRows = section.products
      .map((row) => row.product)
      .filter((product) => product && product.isActive && product.isVisible)
      .slice(0, section.maxItems || 12);

    if (!productRows.length) continue;

    const products = await mapProductsForStore(prisma, productRows, req);
    sections.push({
      id: section.id,
      title: section.title,
      subtitle: section.subtitle,
      products,
    });
  }

  return sections;
}

class HomeShowcaseController {
  async listPublic(req, res) {
    try {
      const sections = await loadPublicSections(req);
      return res.json({ sections });
    } catch (err) {
      console.error('[HomeShowcase.listPublic]', err);
      return res.status(500).json({ error: 'Erro ao carregar vitrine' });
    }
  }

  async listAdmin(req, res) {
    try {
      await ensureLegacyShowcaseSection();
      const sections = await prisma.homeShowcaseSection.findMany({
        orderBy: { sortOrder: 'asc' },
        include: {
          products: {
            orderBy: { sortOrder: 'asc' },
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  imageUrl: true,
                  featured: true,
                  isActive: true,
                  isVisible: true,
                },
              },
            },
          },
          _count: { select: { products: true } },
        },
      });
      return res.json({ sections });
    } catch (err) {
      console.error('[HomeShowcase.listAdmin]', err);
      return res.status(500).json({ error: 'Erro ao listar seções' });
    }
  }

  async listFeaturedProducts(req, res) {
    try {
      const products = await prisma.product.findMany({
        where: { featured: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          featured: true,
          isActive: true,
          isVisible: true,
        },
      });
      return res.json({ products });
    } catch (err) {
      console.error('[HomeShowcase.listFeaturedProducts]', err);
      return res.status(500).json({ error: 'Erro ao listar produtos em destaque' });
    }
  }

  async create(req, res) {
    try {
      const title = sanitizeString(req.body?.title, 120);
      if (!title) return res.status(400).json({ error: 'Título é obrigatório' });

      const productIds = Array.isArray(req.body?.productIds)
        ? req.body.productIds.map((pid) => sanitizeString(pid, 80)).filter(Boolean)
        : [];

      const total = await prisma.homeShowcaseSection.count();

      const section = await prisma.$transaction(async (tx) => {
        const created = await tx.homeShowcaseSection.create({
          data: {
            title,
            subtitle: req.body?.subtitle ? sanitizeString(req.body.subtitle, 200) : null,
            enabled: req.body?.enabled !== false,
            sortOrder: total,
            maxItems: Math.max(1, Math.min(24, Number(req.body?.maxItems) || 12)),
          },
        });

        if (productIds.length) {
          await tx.homeShowcaseSectionProduct.createMany({
            data: productIds.map((productId, index) => ({
              sectionId: created.id,
              productId,
              sortOrder: index,
            })),
            skipDuplicates: true,
          });
        }

        return created;
      });

      return res.status(201).json(section);
    } catch (err) {
      console.error('[HomeShowcase.create]', err);
      return res.status(500).json({ error: 'Erro ao criar seção' });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const data = {};

      if (req.body?.title !== undefined) {
        const title = sanitizeString(req.body.title, 120);
        if (!title) return res.status(400).json({ error: 'Título inválido' });
        data.title = title;
      }
      if (req.body?.subtitle !== undefined) {
        data.subtitle = req.body.subtitle ? sanitizeString(req.body.subtitle, 200) : null;
      }
      if (req.body?.enabled !== undefined) data.enabled = Boolean(req.body.enabled);
      if (req.body?.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder) || 0;
      if (req.body?.maxItems !== undefined) {
        data.maxItems = Math.max(1, Math.min(24, Number(req.body.maxItems) || 12));
      }

      const section = await prisma.homeShowcaseSection.update({ where: { id }, data });

      if (Array.isArray(req.body?.productIds)) {
        const productIds = req.body.productIds
          .map((pid) => sanitizeString(pid, 80))
          .filter(Boolean);

        await prisma.homeShowcaseSectionProduct.deleteMany({ where: { sectionId: id } });

        if (productIds.length) {
          await prisma.homeShowcaseSectionProduct.createMany({
            data: productIds.map((productId, index) => ({
              sectionId: id,
              productId,
              sortOrder: index,
            })),
            skipDuplicates: true,
          });
        }
      }

      return res.json(section);
    } catch (err) {
      if (err?.code === 'P2025') return res.status(404).json({ error: 'Seção não encontrada' });
      console.error('[HomeShowcase.update]', err);
      return res.status(500).json({ error: 'Erro ao atualizar seção' });
    }
  }

  async remove(req, res) {
    try {
      const id = sanitizeString(req.params.id, 40);
      const { count } = await prisma.homeShowcaseSection.deleteMany({ where: { id } });
      if (!count) return res.status(404).json({ error: 'Seção não encontrada' });
      return res.json({ success: true });
    } catch (err) {
      console.error('[HomeShowcase.remove]', err);
      return res.status(500).json({ error: 'Erro ao excluir seção' });
    }
  }

  async reorder(req, res) {
    try {
      const items = req.body?.items;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Lista de itens inválida' });
      }

      const ids = items.map((item) => sanitizeString(item?.id, 40)).filter(Boolean);
      if (!ids.length) return res.status(400).json({ error: 'Lista de itens inválida' });

      await prisma.$transaction(
        ids.map((id, index) =>
          prisma.homeShowcaseSection.updateMany({
            where: { id },
            data: { sortOrder: index },
          })
        )
      );

      return res.json({ success: true });
    } catch (err) {
      console.error('[HomeShowcase.reorder]', err);
      return res.status(500).json({ error: 'Erro ao reordenar seções' });
    }
  }
}

module.exports = new HomeShowcaseController();
module.exports.loadPublicSections = loadPublicSections;
module.exports.ensureLegacyShowcaseSection = ensureLegacyShowcaseSection;
