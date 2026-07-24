const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');
const { normalizeCheckoutSettings } = require('../utils/checkoutConfig');
const { normalizePluginsConfig, mergePreservedPluginSecrets } = require('../utils/pluginsConfig');
const { maskPluginsConfigForAdmin } = require('../utils/publicPluginsConfig');
const { ensureDefaultPageSeo, ensureDefaultReviews } = require('./homeReview.controllers');
const { userHasPermission } = require('../middleware/permissionMiddleware');
const {
  recordAdminAction,
  AUDIT_ACTIONS,
  requestContext,
} = require('../services/auditLog.service');
const { DEFAULT_INSTITUTIONAL_PAGES } = require('../utils/institutionalPages');
const {
  getDefaultLayoutForSlug,
  sanitizeLayoutData,
  resolveLayoutType,
} = require('../utils/institutionalLayout');

const DEFAULT_FOOTER_MARKETPLACE_LINKS = [
  { label: 'Minha Conta', href: '/account' },
  { label: 'Meus Pedidos', href: '/account/orders' },
  { label: 'Lista de Desejos', href: '/account/wishlist' },
];

const DEFAULT_FOOTER_CATEGORY_LINKS = [
  { label: 'Mais Vendidos', href: '/products' },
  { label: 'Lançamentos', href: '/products' },
  { label: 'Playstation', href: '/products' },
  { label: 'Nintendo', href: '/products', badge: 'New' },
  { label: 'Lifestyle', href: '/products', external: true },
];

const DEFAULT_FOOTER_SUPPORT_LINKS = [
  { label: 'Fale Conosco', href: '/trust/fale-conosco' },
  { label: 'Como comprar', href: '/trust/como-comprar' },
  { label: 'Como funciona', href: '/trust/como-funciona' },
  { label: 'Central de Ajuda', href: '/trust/support' },
];

const DEFAULT_FOOTER_COMPANY_LINKS = [
  { label: 'Termos de Uso', href: '/enterprise/terms' },
  { label: 'Política de privacidade', href: '/enterprise/privacy' },
  { label: 'Política de cookies', href: '/enterprise/cookies' },
  { label: 'Política de Trocas e Devoluções', href: '/enterprise/refunds' },
];

const DEFAULT_FOOTER_BOTTOM_LINKS = [
  { label: 'Quem somos', href: '/about' },
  { label: 'Envio Expresso', href: '/trust/envio-expresso' },
  { label: 'Nossas Avaliações', href: '/#reviews' },
];

/** @deprecated migrado para footerCompanyLinks + footerBottomLinks */
const DEFAULT_FOOTER_LEGAL_LINKS = [
  ...DEFAULT_FOOTER_BOTTOM_LINKS,
  ...DEFAULT_FOOTER_COMPANY_LINKS,
];

function sanitizeLinks(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const result = [];
  for (const item of raw) {
    const link = {
      label: sanitizeString(item?.label, 80),
      href: sanitizeString(item?.href, 300),
      badge: item?.badge ? sanitizeString(item.badge, 20) : undefined,
      external: Boolean(item?.external),
    };
    if (!link.label || !link.href) continue;
    const key = `${link.href}::${link.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

function dedupeLinks(links) {
  if (!Array.isArray(links)) return [];
  const seen = new Set();
  const result = [];
  for (const link of links) {
    if (!link?.href || !link?.label) continue;
    const key = `${link.href}::${link.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

const COMPANY_HREF_MIGRATION = {
  '/terms': '/enterprise/terms',
  '/privacy': '/enterprise/privacy',
  '/cookies': '/enterprise/cookies',
  '/refunds': '/enterprise/refunds',
};

const SUPPORT_HREF_BY_LABEL = {
  'Central de Ajuda': '/trust/support',
  'Fale Conosco': '/trust/fale-conosco',
  'Como comprar': '/trust/como-comprar',
  'Como funciona': '/trust/como-funciona',
};

const BOTTOM_HREF_BY_LABEL = {
  'Envio Expresso': '/trust/envio-expresso',
};

function migrateFooterLinkCollection(links, type) {
  if (!Array.isArray(links)) return { links, changed: false };

  let changed = false;
  const migrated = links.map((link) => {
    if (!link?.href) return link;

    let nextHref = link.href;
    if (type === 'company' && COMPANY_HREF_MIGRATION[link.href]) {
      nextHref = COMPANY_HREF_MIGRATION[link.href];
    }
    if (type === 'support') {
      if (SUPPORT_HREF_BY_LABEL[link.label]) {
        nextHref = SUPPORT_HREF_BY_LABEL[link.label];
      } else if (link.href === '/support') {
        nextHref = '/trust/support';
      }
    }
    if (type === 'bottom') {
      if (BOTTOM_HREF_BY_LABEL[link.label]) {
        nextHref = BOTTOM_HREF_BY_LABEL[link.label];
      } else if (link.href === '/support' && link.label === 'Envio Expresso') {
        nextHref = '/trust/envio-expresso';
      }
    }

    if (nextHref !== link.href) {
      changed = true;
      return { ...link, href: nextHref };
    }
    return link;
  });

  return { links: migrated, changed };
}

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

  // Garante links do rodapé sem sobrescrever customizações
  const config = await prisma.siteConfig.findUnique({
    where: { id: 'default' },
    select: {
      footerLegalLinks: true,
      footerSupportLinks: true,
      footerCategoryLinks: true,
      footerMarketplaceLinks: true,
      footerCompanyLinks: true,
      footerBottomLinks: true,
      footerMarketplaceColumnTitle: true,
      footerCompanyColumnTitle: true,
      footerCategoryColumnTitle: true,
      footerSupportColumnTitle: true,
    },
  });
  if (!config) return;

  const companyMigration = migrateFooterLinkCollection(config.footerCompanyLinks, 'company');
  const supportMigration = migrateFooterLinkCollection(config.footerSupportLinks, 'support');
  const legalMigration = migrateFooterLinkCollection(config.footerLegalLinks, 'company');
  const bottomMigration = migrateFooterLinkCollection(config.footerBottomLinks, 'bottom');

  const legal = dedupeLinks(Array.isArray(legalMigration.links) ? legalMigration.links : []);
  const support = dedupeLinks(Array.isArray(supportMigration.links) ? supportMigration.links : []);
  const category = dedupeLinks(Array.isArray(config.footerCategoryLinks) ? config.footerCategoryLinks : []);
  const marketplace = dedupeLinks(
    Array.isArray(config.footerMarketplaceLinks) ? config.footerMarketplaceLinks : []
  );
  const company = dedupeLinks(Array.isArray(companyMigration.links) ? companyMigration.links : []);
  const bottom = dedupeLinks(Array.isArray(bottomMigration.links) ? bottomMigration.links : []);
  const data = {};
  let changed =
    companyMigration.changed ||
    supportMigration.changed ||
    legalMigration.changed ||
    bottomMigration.changed;

  const originalBottomLen = Array.isArray(config.footerBottomLinks) ? config.footerBottomLinks.length : 0;
  const originalSupportLen = Array.isArray(config.footerSupportLinks) ? config.footerSupportLinks.length : 0;
  const originalCompanyLen = Array.isArray(config.footerCompanyLinks) ? config.footerCompanyLinks.length : 0;
  const originalLegalLen = Array.isArray(config.footerLegalLinks) ? config.footerLegalLinks.length : 0;

  if (
    bottom.length !== originalBottomLen ||
    support.length !== originalSupportLen ||
    company.length !== originalCompanyLen ||
    legal.length !== originalLegalLen
  ) {
    changed = true;
  }

  for (const link of DEFAULT_FOOTER_LEGAL_LINKS) {
    if (!legal.some((l) => l && l.href === link.href)) {
      legal.push(link);
      changed = true;
    }
  }
  for (const link of DEFAULT_FOOTER_SUPPORT_LINKS) {
    if (!support.some((l) => l && l.href === link.href && l.label === link.label)) {
      support.push(link);
      changed = true;
    }
  }
  for (const link of DEFAULT_FOOTER_CATEGORY_LINKS) {
    if (!category.some((l) => l && l.href === link.href && l.label === link.label)) {
      category.push(link);
      changed = true;
    }
  }
  for (const link of DEFAULT_FOOTER_MARKETPLACE_LINKS) {
    if (!marketplace.some((l) => l && l.href === link.href)) {
      marketplace.push(link);
      changed = true;
    }
  }
  for (const link of DEFAULT_FOOTER_COMPANY_LINKS) {
    if (!company.some((l) => l && l.href === link.href)) {
      company.push(link);
      changed = true;
    }
  }
  for (const link of DEFAULT_FOOTER_BOTTOM_LINKS) {
    if (!bottom.some((l) => l && l.href === link.href)) {
      bottom.push(link);
      changed = true;
    }
  }

  if (!config.footerMarketplaceColumnTitle) {
    data.footerMarketplaceColumnTitle = 'Marketplace';
    changed = true;
  }
  if (!config.footerCompanyColumnTitle) {
    data.footerCompanyColumnTitle = 'Empresa';
    changed = true;
  }
  if (!config.footerCategoryColumnTitle) {
    data.footerCategoryColumnTitle = 'Categorias';
    changed = true;
  }
  if (!config.footerSupportColumnTitle || config.footerSupportColumnTitle === 'Suporte:') {
    data.footerSupportColumnTitle = 'Confiança';
    changed = true;
  }

  if (marketplace.length === 0) {
    data.footerMarketplaceLinks = DEFAULT_FOOTER_MARKETPLACE_LINKS;
    changed = true;
  } else if (marketplace.length > (Array.isArray(config.footerMarketplaceLinks) ? config.footerMarketplaceLinks.length : 0)) {
    data.footerMarketplaceLinks = marketplace;
    changed = true;
  }

  if (supportMigration.changed || support.length > (Array.isArray(config.footerSupportLinks) ? config.footerSupportLinks.length : 0)) {
    data.footerSupportLinks = support;
    changed = true;
  }

  if (companyMigration.changed || company.length > (Array.isArray(config.footerCompanyLinks) ? config.footerCompanyLinks.length : 0)) {
    data.footerCompanyLinks = company.length ? company : DEFAULT_FOOTER_COMPANY_LINKS;
    changed = true;
  }

  if (company.length === 0) {
    data.footerCompanyLinks = DEFAULT_FOOTER_COMPANY_LINKS;
    changed = true;
  }

  if (bottom.length === 0) {
    data.footerBottomLinks = DEFAULT_FOOTER_BOTTOM_LINKS;
    changed = true;
  } else if (
    bottomMigration.changed ||
    bottom.length !== originalBottomLen ||
    bottom.length > originalBottomLen
  ) {
    data.footerBottomLinks = bottom;
    changed = true;
  }

  if (category.length > (Array.isArray(config.footerCategoryLinks) ? config.footerCategoryLinks.length : 0)) {
    data.footerCategoryLinks = category;
    changed = true;
  }

  if (changed) {
    await prisma.siteConfig.update({
      where: { id: 'default' },
      data: {
        ...data,
        footerLegalLinks: legal,
        footerSupportLinks: support,
        footerCompanyLinks: company.length ? company : DEFAULT_FOOTER_COMPANY_LINKS,
        footerBottomLinks: bottom.length ? bottom : DEFAULT_FOOTER_BOTTOM_LINKS,
      },
    });
  }
}

async function getOrCreateSiteConfig() {
  return prisma.siteConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      storeName: 'Space Point',
      footerAboutText:
        'A Space Point BR LTDA é uma empresa brasileira especializada na venda de jogos digitais para consoles PlayStation, oferecendo uma experiência prática, segura e acessível para gamers de todo o país.',
      footerAboutTitle: 'Sobre a loja:',
      footerCopyright: 'SPACE POINT BR LTDA – CNPJ: 52.527.026/0001-56 © Todos os direitos reservados, {year}.',
      footerNewsletterEnabled: true,
      footerNewsletterPlaceholder: 'Seu e-mail',
      footerNewsletterButtonLabel: 'Inscrever',
      footerLogoHref: '/',
      footerLogoAlt: 'Space Point',
      footerBackgroundColor: '#A855F7',
      footerButtonTextColor: '#A855F7',
      footerShowNoise: true,
      footerPaddingTopHome: 192,
      footerPaddingTopDefault: 48,
      footerMarketplaceColumnTitle: 'Marketplace',
      footerCategoryColumnTitle: 'Categorias',
      footerSupportColumnTitle: 'Confiança',
      footerCompanyColumnTitle: 'Empresa',
      footerMarketplaceLinks: DEFAULT_FOOTER_MARKETPLACE_LINKS,
      footerCategoryLinks: DEFAULT_FOOTER_CATEGORY_LINKS,
      footerSupportLinks: DEFAULT_FOOTER_SUPPORT_LINKS,
      footerCompanyLinks: DEFAULT_FOOTER_COMPANY_LINKS,
      footerBottomLinks: DEFAULT_FOOTER_BOTTOM_LINKS,
      footerLegalLinks: DEFAULT_FOOTER_LEGAL_LINKS,
      topBarEnabled: false,
      topBarBackgroundColor: '#9333EA',
      topBarTextColor: '#ffffff',
      topBarDismissible: true,
      maintenanceModeEnabled: false,
      maintenanceTitle: 'Voltamos em breve',
      maintenanceMessage: 'Estamos realizando melhorias na loja. Tente novamente em alguns minutos.',
      page404Title: 'Página não encontrada',
      page404Message: 'O conteúdo que você procura não existe ou foi removido.',
      page404ButtonLabel: 'Voltar para a loja',
      page404ButtonHref: '/',
      homeReviewsEnabled: true,
      homeReviewsBadgeLabel: 'Google Reviews',
      homeReviewsTitle: 'O que nossos clientes dizem',
      homeReviewsAverageRating: 4.9,
      homeReviewsTotalCount: 127,
      homeReviewsGoogleMapsUrl:
        'https://www.google.com/maps/place/SPACE+POINT+BR/@-7.2093142,-35.9250211,17z',
      homeReviewsLinkLabel: 'Ver todas',
      homeFamousEnabled: true,
      homeFamousTitlePrimary: 'Famosos',
      homeFamousTitleSecondary: 'Que Indicam',
    },
  });
}

class SiteAdminController {
  async getSettings(req, res) {
    try {
      await ensureInstitutionalDefaults();
      await ensureDefaultPageSeo();
      await ensureDefaultReviews();
      const [config, pages] = await Promise.all([
        getOrCreateSiteConfig(),
        prisma.institutionalPage.findMany({ orderBy: { sortOrder: 'asc' } }),
      ]);
      return res.json({
        config: {
          ...config,
          checkoutSettings: normalizeCheckoutSettings(config.checkoutSettings),
          pluginsConfig: maskPluginsConfigForAdmin(config.pluginsConfig),
        },
        institutionalPages: pages,
      });
    } catch (err) {
      console.error('[SiteAdmin.getSettings]', err);
      return res.status(500).json({ error: 'Erro ao carregar configurações do site' });
    }
  }

  async updateSettings(req, res) {
    try {
      const body = req.body ?? {};
      const data = {};

      const stringFields = [
        'bannerImageUrl', 'bannerTitle', 'bannerSubtitle', 'bannerCtaLabel', 'bannerCtaHref',
        'footerText', 'metaDescription', 'metaTitle', 'storeName', 'faviconUrl', 'logoUrl',
        'contactEmail', 'contactPhone', 'primaryColor', 'footerCopyright', 'footerAboutTitle',
        'footerNewsletterPlaceholder', 'footerNewsletterButtonLabel', 'footerLogoUrl',
        'footerLogoHref', 'footerLogoAlt', 'footerBackgroundColor', 'footerButtonTextColor',
        'footerCategoryColumnTitle', 'footerSupportColumnTitle',
        'footerMarketplaceColumnTitle', 'footerCompanyColumnTitle',
        'topBarText', 'topBarLinkUrl', 'topBarBackgroundColor', 'topBarTextColor',
        'maintenanceTitle', 'maintenanceImageUrl',
        'page404Title', 'page404ButtonLabel', 'page404ButtonHref',
        'homeReviewsBadgeLabel', 'homeReviewsTitle', 'homeReviewsGoogleMapsUrl',
        'homeReviewsLinkLabel',
        'homeFamousTitlePrimary', 'homeFamousTitleSecondary',
        'homeShowcaseTitle', 'homeShowcaseSubtitle',
        'popupTitle', 'popupDescription', 'popupImageUrl', 'popupCtaLabel', 'popupCtaLink',
        'socialFacebook', 'socialInstagram', 'socialTwitter', 'socialLinkedin', 'socialYoutube',
        'chatWelcomeMessage', 'chatPreChatQuestions', 'chatAutomatedMessages',
      ];

      const booleanFields = [
        'footerNewsletterEnabled', 'footerShowNoise', 'topBarEnabled', 'topBarDismissible',
        'maintenanceModeEnabled', 'homeReviewsEnabled', 'homeFamousEnabled',
        'homeShowcaseEnabled', 'popupEnabled', 'chatPreChatEnabled',
      ];
      for (const field of booleanFields) {
        if (body[field] !== undefined) {
          data[field] = Boolean(body[field]);
        }
      }

      const intFields = ['footerPaddingTopHome', 'footerPaddingTopDefault', 'homeReviewsTotalCount'];
      const floatFields = ['homeReviewsAverageRating'];
      for (const field of floatFields) {
        if (body[field] !== undefined) {
          const n = parseFloat(body[field]);
          data[field] = Number.isFinite(n) ? Math.min(Math.max(n, 0), 5) : null;
        }
      }
      for (const field of intFields) {
        if (body[field] !== undefined) {
          const n = parseInt(body[field], 10);
          data[field] = Number.isFinite(n) ? Math.min(Math.max(n, 0), 400) : 48;
        }
      }

      for (const field of stringFields) {
        if (body[field] !== undefined) {
          data[field] = body[field] ? sanitizeString(body[field], field === 'footerText' || field === 'footerAboutText' ? 5000 : 500) : null;
        }
      }

      if (body.footerAboutText !== undefined) {
        data.footerAboutText = body.footerAboutText
          ? sanitizeString(body.footerAboutText, 5000)
          : null;
      }

      if (body.footerCategoryLinks !== undefined) {
        data.footerCategoryLinks = sanitizeLinks(body.footerCategoryLinks);
      }
      if (body.footerSupportLinks !== undefined) {
        data.footerSupportLinks = sanitizeLinks(body.footerSupportLinks);
      }
      if (body.footerLegalLinks !== undefined) {
        data.footerLegalLinks = sanitizeLinks(body.footerLegalLinks);
      }
      if (body.footerMarketplaceLinks !== undefined) {
        data.footerMarketplaceLinks = sanitizeLinks(body.footerMarketplaceLinks);
      }
      if (body.footerCompanyLinks !== undefined) {
        data.footerCompanyLinks = sanitizeLinks(body.footerCompanyLinks);
      }
      if (body.footerBottomLinks !== undefined) {
        data.footerBottomLinks = sanitizeLinks(body.footerBottomLinks);
      }

      if (body.socialLinks !== undefined) {
        data.socialLinks = Array.isArray(body.socialLinks)
          ? body.socialLinks.map((l) => ({
              platform: sanitizeString(l.platform, 50),
              url: sanitizeString(l.url, 500),
            })).filter(l => l.platform && l.url)
          : null;
      }

      if (body.popupTrigger !== undefined) {
        const trigger = sanitizeString(body.popupTrigger, 20);
        data.popupTrigger = ['entry', 'exit', 'delay'].includes(trigger) ? trigger : 'entry';
      }

      if (body.popupDelay !== undefined) {
        const n = parseInt(body.popupDelay, 10);
        data.popupDelay = Number.isFinite(n) ? Math.min(Math.max(n, 1), 300) : 5;
      }

      if (body.popupDescription !== undefined) {
        data.popupDescription = body.popupDescription
          ? sanitizeString(body.popupDescription, 2000)
          : null;
      }

      if (body.checkoutSettings !== undefined) {
        data.checkoutSettings = normalizeCheckoutSettings(body.checkoutSettings);
      }

      if (body.reviewsSettings !== undefined) {
        const { normalizeReviewsSettings } = require('../utils/reviewsSettings');
        data.reviewsSettings = normalizeReviewsSettings(body.reviewsSettings);
      }

      const previous = await prisma.siteConfig.findUnique({ where: { id: 'default' } });

      if (body.pluginsConfig !== undefined) {
        const canManagePlugins = await userHasPermission(req.user?.id, 'plugins:manage');
        if (!canManagePlugins) {
          return res.status(403).json({
            error: "Acesso negado: falta a permissão 'plugins:manage'",
          });
        }
        data.pluginsConfig = mergePreservedPluginSecrets(
          normalizePluginsConfig(body.pluginsConfig),
          previous?.pluginsConfig
        );
      }

      const config = await prisma.siteConfig.upsert({
        where: { id: 'default' },
        update: data,
        create: { id: 'default', ...data },
      });

      const ctx = requestContext(req);
      const changedKeys = Object.keys(data);

      if (body.pluginsConfig !== undefined) {
        const before = previous?.pluginsConfig && typeof previous.pluginsConfig === 'object'
          ? previous.pluginsConfig
          : {};
        const after = config.pluginsConfig && typeof config.pluginsConfig === 'object'
          ? config.pluginsConfig
          : {};
        const pluginIds = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
        const pluginChanges = [];

        for (const pluginId of pluginIds) {
          const prevEntry = before[pluginId] || {};
          const nextEntry = after[pluginId] || {};
          const prevEnabled = Boolean(prevEntry.enabled ?? prevEntry.isEnabled);
          const nextEnabled = Boolean(nextEntry.enabled ?? nextEntry.isEnabled);
          const configChanged = JSON.stringify(prevEntry) !== JSON.stringify(nextEntry);
          if (prevEnabled === nextEnabled && !configChanged) continue;
          pluginChanges.push({
            pluginId,
            oldEnabled: prevEnabled,
            newEnabled: nextEnabled,
            configChanged,
          });
        }

        if (pluginChanges.length) {
          await recordAdminAction({
            ...ctx,
            action: AUDIT_ACTIONS.PLUGIN_UPDATE,
            targetType: 'plugin',
            targetId: pluginChanges.map((p) => p.pluginId).join(','),
            metadata: { plugins: pluginChanges },
          });
        }
      }

      const settingsKeys = changedKeys.filter((k) => k !== 'pluginsConfig');
      if (settingsKeys.length) {
        await recordAdminAction({
          ...ctx,
          action: AUDIT_ACTIONS.SETTINGS_UPDATE,
          targetType: 'siteConfig',
          targetId: 'default',
          metadata: {
            changedKeys: settingsKeys.slice(0, 40),
            section: settingsKeys.some((k) => k.startsWith('footer'))
              ? 'footer'
              : settingsKeys.some((k) => k.startsWith('topBar') || k.startsWith('popup') || k.startsWith('home'))
                ? 'pages'
                : settingsKeys.includes('checkoutSettings')
                  ? 'checkout'
                  : 'geral',
          },
        });
      }

      return res.json({
        ...config,
        pluginsConfig: maskPluginsConfigForAdmin(config.pluginsConfig),
      });
    } catch (err) {
      console.error('[SiteAdmin.updateSettings]', err);
      return res.status(500).json({ error: 'Erro ao salvar configurações do site' });
    }
  }

  async listInstitutionalPages(req, res) {
    try {
      await ensureInstitutionalDefaults();
      const pages = await prisma.institutionalPage.findMany({
        orderBy: { sortOrder: 'asc' },
      });
      const normalized = pages.map((page) => {
        const layoutType = resolveLayoutType(page.slug, page.layoutType);
        return {
          ...page,
          layoutType,
          layoutData: layoutType
            ? sanitizeLayoutData(layoutType, page.layoutData, page.slug)
            : page.layoutData,
        };
      });
      return res.json({ pages: normalized });
    } catch (err) {
      console.error('[SiteAdmin.listInstitutionalPages]', err);
      return res.status(500).json({ error: 'Erro ao listar páginas institucionais' });
    }
  }

  async updateInstitutionalPage(req, res) {
    try {
      const slug = sanitizeString(req.params.slug, 60);
      if (!slug) return res.status(400).json({ error: 'Slug inválido' });

      const {
        title,
        content,
        isPublished,
        sortOrder,
        metaTitle,
        metaDescription,
        layoutType,
        layoutData,
      } = req.body ?? {};
      const data = {};

      if (title !== undefined) {
        const t = sanitizeString(title, 120);
        if (!t) return res.status(400).json({ error: 'Título é obrigatório' });
        data.title = t;
      }
      if (content !== undefined) data.content = content;
      if (metaTitle !== undefined) {
        data.metaTitle = metaTitle ? sanitizeString(metaTitle, 120) : null;
      }
      if (metaDescription !== undefined) {
        data.metaDescription = metaDescription ? sanitizeString(metaDescription, 500) : null;
      }
      if (isPublished !== undefined) data.isPublished = Boolean(isPublished);
      if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;

      if (layoutType !== undefined || layoutData !== undefined) {
        const resolvedType = resolveLayoutType(slug, layoutType || null);
        if (layoutType !== undefined) {
          data.layoutType = resolvedType;
        }
        if (layoutData !== undefined) {
          const typeForData =
            resolvedType ||
            (await prisma.institutionalPage.findUnique({
              where: { slug },
              select: { layoutType: true },
            }))?.layoutType ||
            null;
          data.layoutData = typeForData
            ? sanitizeLayoutData(typeForData, layoutData, slug)
            : layoutData;
        }
      }

      const page = await prisma.institutionalPage.update({
        where: { slug },
        data,
      });

      return res.json(page);
    } catch (err) {
      if (err?.code === 'P2025') {
        return res.status(404).json({ error: 'Página não encontrada' });
      }
      console.error('[SiteAdmin.updateInstitutionalPage]', err);
      return res.status(500).json({ error: 'Erro ao atualizar página' });
    }
  }
}

module.exports = new SiteAdminController();
