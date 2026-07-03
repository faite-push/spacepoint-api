const { prisma } = require('../config/prisma');
const { resolveEntityMedia } = require('../utils/mediaUrl');
const { normalizeCheckoutSettings } = require('../utils/checkoutConfig');
const { normalizeReviewsSettings } = require('../utils/reviewsSettings');

function sanitizePublicPluginsConfig(pluginsConfig) {
  if (!pluginsConfig || typeof pluginsConfig !== 'object' || Array.isArray(pluginsConfig)) {
    return null;
  }

  const out = {};
  for (const [id, entry] of Object.entries(pluginsConfig)) {
    if (
      entry &&
      typeof entry === 'object' &&
      entry.enabled === true &&
      entry.config &&
      typeof entry.config === 'object' &&
      !Array.isArray(entry.config)
    ) {
      out[id] = { enabled: true, config: entry.config };
    }
  }

  return Object.keys(out).length > 0 ? out : null;
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
