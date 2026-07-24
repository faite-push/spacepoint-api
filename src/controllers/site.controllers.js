const { prisma } = require('../config/prisma');
const { resolveEntityMedia } = require('../utils/mediaUrl');
const { normalizeCheckoutSettings } = require('../utils/checkoutConfig');
const { normalizeReviewsSettings } = require('../utils/reviewsSettings');
const { sanitizePublicPluginsConfig } = require('../utils/publicPluginsConfig');
const { DEFAULT_INSTITUTIONAL_PAGES } = require('../utils/institutionalPages');
const {
  getDefaultLayoutForSlug,
  sanitizeLayoutData,
  resolveLayoutType,
} = require('../utils/institutionalLayout');

async function ensureInstitutionalDefaults() {
  for (const p of DEFAULT_INSTITUTIONAL_PAGES) {
    const existing = await prisma.institutionalPage.findUnique({
      where: { slug: p.slug },
      select: { id: true, layoutType: true, layoutData: true },
    });
    if (!existing) {
      await prisma.institutionalPage.create({
        data: {
          slug: p.slug,
          title: p.title,
          content: p.content,
          layoutType: p.layoutType || null,
          layoutData: p.layoutData || null,
          sortOrder: p.sortOrder,
          isPublished: true,
          metaTitle: p.metaTitle || null,
          metaDescription: p.metaDescription || null,
        },
      });
      continue;
    }

    if (!existing.layoutType || existing.layoutData == null) {
      const defaults = getDefaultLayoutForSlug(p.slug);
      if (defaults.layoutType) {
        await prisma.institutionalPage.update({
          where: { slug: p.slug },
          data: {
            layoutType: existing.layoutType || defaults.layoutType,
            layoutData: existing.layoutData ?? defaults.layoutData,
          },
        });
      }
    }
  }
}

class SiteController {
  async getConfig(req, res) {
    const config = await prisma.siteConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });

    const resolved = resolveEntityMedia(config, req);
    const { pluginsConfig: _rawPlugins, ...publicConfig } = resolved;

    return res.json({
      ...publicConfig,
      checkoutSettings: normalizeCheckoutSettings(config.checkoutSettings),
      reviewsSettings: normalizeReviewsSettings(config.reviewsSettings),
      pluginsConfig: sanitizePublicPluginsConfig(config.pluginsConfig),
    });
  }

  async getInstitutionalPage(req, res) {
    try {
      const slug = String(req.params.slug || '').trim().toLowerCase();
      if (!slug) return res.status(400).json({ error: 'Slug inválido' });

      await ensureInstitutionalDefaults();

      const page = await prisma.institutionalPage.findFirst({
        where: { slug, isPublished: true },
      });

      if (!page) return res.status(404).json({ error: 'Página não encontrada' });

      const layoutType = resolveLayoutType(slug, page.layoutType);
      const layoutData = layoutType
        ? sanitizeLayoutData(layoutType, page.layoutData, slug)
        : page.layoutData;

      return res.json({
        ...page,
        layoutType,
        layoutData,
      });
    } catch (err) {
      console.error('[Site.getInstitutionalPage]', err);
      return res.status(500).json({ error: 'Erro ao carregar página' });
    }
  }

  async getHome(req, res) {
    const { loadPublicSections } = require('../controllers/homeShowcase.controllers');
    const sections = await loadPublicSections(req);

    const banners = await prisma.banner.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    return res.json({
      sections,
      featured: sections[0]?.products || [],
      banners: banners.map((banner) => resolveEntityMedia(banner, req)),
    });
  }
}

module.exports = new SiteController();
