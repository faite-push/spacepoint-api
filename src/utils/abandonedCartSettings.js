const DEFAULT_ABANDONED_CART_SETTINGS = {
  enabled: true,
  delayHours: 1,
  minSubtotalCents: 500,
  sendRecoveryEmail: true,
};

function normalizeAbandonedCartSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_ABANDONED_CART_SETTINGS };
  }

  return {
    enabled: raw.enabled !== false,
    delayHours:
      Number.isFinite(Number(raw.delayHours)) && Number(raw.delayHours) > 0
        ? Math.min(168, Math.floor(Number(raw.delayHours)))
        : DEFAULT_ABANDONED_CART_SETTINGS.delayHours,
    minSubtotalCents:
      Number.isFinite(Number(raw.minSubtotalCents)) && Number(raw.minSubtotalCents) >= 0
        ? Math.floor(Number(raw.minSubtotalCents))
        : DEFAULT_ABANDONED_CART_SETTINGS.minSubtotalCents,
    sendRecoveryEmail: raw.sendRecoveryEmail !== false,
  };
}

async function getAbandonedCartSettings(prisma) {
  const config = await prisma.siteConfig.findUnique({
    where: { id: 'default' },
    select: { abandonedCartSettings: true },
  });
  return normalizeAbandonedCartSettings(config?.abandonedCartSettings);
}

module.exports = {
  DEFAULT_ABANDONED_CART_SETTINGS,
  normalizeAbandonedCartSettings,
  getAbandonedCartSettings,
};
