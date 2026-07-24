const DEFAULT_REVIEWS_SETTINGS = {
  enabled: true,
  showOnHomepage: true,
  homeTitle: 'Depoimentos de clientes',
  homeSubtitle: 'Experiências reais de quem já confiou na nossa loja',
  autoPublish: false,
  allowScreenshots: false,
  autoCloseChatOnDelivery: false,
  sendReviewInviteEmail: true,
  reviewReminderHours: 24,
  opinionTags: ['Muito bom', 'Entrega rápida', 'Confiável', 'Voltarei a comprar', 'Ótimo suporte'],
};

function normalizeReviewsSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_REVIEWS_SETTINGS };
  }

  return {
    enabled: raw.enabled !== false,
    showOnHomepage: raw.showOnHomepage !== false,
    homeTitle:
      typeof raw.homeTitle === 'string' && raw.homeTitle.trim()
        ? raw.homeTitle.trim()
        : DEFAULT_REVIEWS_SETTINGS.homeTitle,
    homeSubtitle:
      typeof raw.homeSubtitle === 'string' && raw.homeSubtitle.trim()
        ? raw.homeSubtitle.trim()
        : DEFAULT_REVIEWS_SETTINGS.homeSubtitle,
    autoPublish: raw.autoPublish === true,
    allowScreenshots: raw.allowScreenshots === true,
    autoCloseChatOnDelivery: raw.autoCloseChatOnDelivery === true,
    sendReviewInviteEmail: raw.sendReviewInviteEmail !== false,
    reviewReminderHours:
      Number.isFinite(Number(raw.reviewReminderHours)) && Number(raw.reviewReminderHours) > 0
        ? Math.min(168, Math.floor(Number(raw.reviewReminderHours)))
        : DEFAULT_REVIEWS_SETTINGS.reviewReminderHours,
    opinionTags: Array.isArray(raw.opinionTags)
      ? raw.opinionTags.filter((tag) => typeof tag === 'string' && tag.trim()).slice(0, 30)
      : DEFAULT_REVIEWS_SETTINGS.opinionTags,
  };
}

async function getReviewsSettings(prisma) {
  const config = await prisma.siteConfig.findUnique({
    where: { id: 'default' },
    select: { reviewsSettings: true },
  });
  return normalizeReviewsSettings(config?.reviewsSettings);
}

module.exports = {
  DEFAULT_REVIEWS_SETTINGS,
  normalizeReviewsSettings,
  getReviewsSettings,
};
