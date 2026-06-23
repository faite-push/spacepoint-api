const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');
const { normalizeCheckoutSettings } = require('../utils/checkoutConfig');
const { ensureDefaultPageSeo, ensureDefaultReviews } = require('./homeReview.controllers');

const DEFAULT_INSTITUTIONAL_PAGES = [
  {
    slug: 'about',
    title: 'Quem somos',
    sortOrder: 0,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'A Space Point BR LTDA é uma empresa brasileira especializada na venda de jogos digitais para consoles PlayStation.',
            },
          ],
        },
      ],
    },
  },
  {
    slug: 'privacy',
    title: 'Política de Privacidade',
    sortOrder: 1,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Conteúdo da política de privacidade. Edite este texto no painel administrativo.' }],
        },
      ],
    },
  },
  {
    slug: 'refunds',
    title: 'Política de Trocas e Devoluções',
    sortOrder: 2,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Conteúdo da política de trocas e devoluções. Edite este texto no painel administrativo.' }],
        },
      ],
    },
  },
];

const DEFAULT_FOOTER_CATEGORY_LINKS = [
  { label: 'Mais Vendidos', href: '/products' },
  { label: 'Lançamentos', href: '/products' },
  { label: 'PlayStation', href: '/products' },
  { label: 'Nintendo', href: '/products', badge: 'New' },
];

const DEFAULT_FOOTER_SUPPORT_LINKS = [
  { label: 'Fale Conosco', href: '/support' },
  { label: 'Como comprar', href: '/support', external: true },
  { label: 'Como funciona', href: '/support', external: true },
];

const DEFAULT_FOOTER_LEGAL_LINKS = [
  { label: 'Quem somos', href: '/about' },
  { label: 'Política de Privacidade', href: '/privacy' },
  { label: 'Política de Trocas e Devoluções', href: '/refunds' },
];

function sanitizeLinks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      label: sanitizeString(item?.label, 80),
      href: sanitizeString(item?.href, 300),
      badge: item?.badge ? sanitizeString(item.badge, 20) : undefined,
      external: Boolean(item?.external),
    }))
    .filter((item) => item.label && item.href);
}

async function ensureInstitutionalDefaults() {
  const count = await prisma.institutionalPage.count();
  if (count > 0) return;
  await prisma.institutionalPage.createMany({
    data: DEFAULT_INSTITUTIONAL_PAGES.map((p) => ({
      slug: p.slug,
      title: p.title,
      content: p.content,
      sortOrder: p.sortOrder,
      isPublished: true,
    })),
  });
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
      footerCopyright: 'SPACE POINT BR LTDA – CNPJ: 52.527.026/0001-95 © Todos os direitos reservados, {year}.',
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
      footerCategoryColumnTitle: 'Categorias:',
      footerSupportColumnTitle: 'Suporte:',
      footerCategoryLinks: DEFAULT_FOOTER_CATEGORY_LINKS,
      footerSupportLinks: DEFAULT_FOOTER_SUPPORT_LINKS,
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
        'topBarText', 'topBarLinkUrl', 'topBarBackgroundColor', 'topBarTextColor',
        'maintenanceTitle', 'maintenanceImageUrl',
        'page404Title', 'page404ButtonLabel', 'page404ButtonHref',
        'homeReviewsBadgeLabel', 'homeReviewsTitle', 'homeReviewsGoogleMapsUrl',
        'homeReviewsLinkLabel',
        'homeShowcaseTitle', 'homeShowcaseSubtitle',
        'popupTitle', 'popupDescription', 'popupImageUrl', 'popupCtaLabel', 'popupCtaLink',
        'socialFacebook', 'socialInstagram', 'socialTwitter', 'socialLinkedin', 'socialYoutube',
      ];

      const booleanFields = [
        'footerNewsletterEnabled', 'footerShowNoise', 'topBarEnabled', 'topBarDismissible',
        'maintenanceModeEnabled', 'homeReviewsEnabled',
        'homeShowcaseEnabled', 'popupEnabled',
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

      const config = await prisma.siteConfig.upsert({
        where: { id: 'default' },
        update: data,
        create: { id: 'default', ...data },
      });

      return res.json(config);
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
      return res.json({ pages });
    } catch (err) {
      console.error('[SiteAdmin.listInstitutionalPages]', err);
      return res.status(500).json({ error: 'Erro ao listar páginas institucionais' });
    }
  }

  async updateInstitutionalPage(req, res) {
    try {
      const slug = sanitizeString(req.params.slug, 60);
      if (!slug) return res.status(400).json({ error: 'Slug inválido' });

      const { title, content, isPublished, sortOrder, metaTitle, metaDescription } = req.body ?? {};
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
