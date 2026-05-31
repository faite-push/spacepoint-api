const { prisma } = require('../config/prisma');

class SiteController {
  async getConfig(req, res) {
    const config = await prisma.siteConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });

    return res.json(config);
  }

  async getInstitutionalPage(req, res) {
    try {
      const slug = req.params.slug;
      if (!slug) return res.status(400).json({ error: 'Slug inválido' });

      const page = await prisma.institutionalPage.findFirst({
        where: { slug, isPublished: true },
      });

      if (!page) return res.status(404).json({ error: 'Página não encontrada' });

      return res.json(page);
    } catch (err) {
      console.error('[Site.getInstitutionalPage]', err);
      return res.status(500).json({ error: 'Erro ao carregar página' });
    }
  }

  async getHome(req, res) {
    const { mapProductForStore, visibleVariantWhere } = require('../utils/productStore');
    const featuredRows = await prisma.product.findMany({
      where: { isActive: true, isVisible: true, featured: true },
      orderBy: { createdAt: 'desc' },
      take: 12,
      include: {
        variants: { where: visibleVariantWhere(), orderBy: { sortOrder: 'asc' } },
      },
    });
    const featured = featuredRows.map((p) => mapProductForStore(p, p.variants));

    const banners = await prisma.banner.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    return res.json({ featured, banners });
  }
}

module.exports = new SiteController();
