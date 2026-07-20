const DEFAULT_WHATSAPP_CART =
  'Olá! {{ nome }}, notamos que deixou um item em seu carrinho, caso tenha alguma dúvida, estamos à disposição para te ajudar com essa compra {{ carrinho }}';

const DEFAULT_WHATSAPP_ORDER =
  'Olá! {{ nome }}, notamos que o seu pedido foi cancelado, mas não se preocupe, você consegue refazê-lo clicando no link a seguir, e caso tenha alguma dúvida estamos à disposição para te ajudar com essa compra {{ carrinho }}';

const CART_EMAIL_DELAY_OPTIONS = [1, 6, 12, 24];
const PRODUCT_EMAIL_DELAY_OPTIONS = [1, 6, 12, 24, 48, 72, 96, 120, 144];
const CANCELLED_ORDER_DELAY_OPTIONS = [1, 6, 12, 24];

const DEFAULT_ABANDONED_CART_SETTINGS = {
  enabled: true,
  /** Minutos sem atividade para considerar o carrinho abandonado (listagem). */
  inactivityMinutes: 20,
  /** Horas após a última atividade para disparar o e-mail de recuperação (legado / menor delay ativo). */
  delayHours: 1,
  minSubtotalCents: 500,
  sendRecoveryEmail: true,
  /** Janela horária (HH:mm) em que notificações automáticas podem sair. */
  notificationWindowStart: '08:00',
  notificationWindowEnd: '23:59',
  /** automated | manual */
  cartSendMode: 'automated',
  whatsappCartMessage: DEFAULT_WHATSAPP_CART,
  whatsappOrderMessage: DEFAULT_WHATSAPP_ORDER,
  /** Horas habilitadas para e-mails de carrinho abandonado. */
  cartEmailDelays: [1, 12, 24],
  abandonedProductEnabled: false,
  abandonedProductDelays: [1, 24, 48],
  cancelledOrderEnabled: false,
  cancelledOrderDelays: [1, 24],
};

function parseTimeHHmm(value, fallback) {
  const raw = String(value || '').trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!match) return fallback;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function normalizeDelayList(raw, allowed, fallback) {
  const source = Array.isArray(raw) ? raw : fallback;
  const set = new Set();
  for (const item of source) {
    const n = Number(item);
    if (allowed.includes(n)) set.add(n);
  }
  const list = allowed.filter((h) => set.has(h));
  return list.length ? list : [...fallback];
}

function normalizeAbandonedCartSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_ABANDONED_CART_SETTINGS };
  }

  const inactivityMinutes =
    Number.isFinite(Number(raw.inactivityMinutes)) && Number(raw.inactivityMinutes) > 0
      ? Math.min(24 * 60, Math.max(5, Math.floor(Number(raw.inactivityMinutes))))
      : DEFAULT_ABANDONED_CART_SETTINGS.inactivityMinutes;

  const legacyDelay =
    Number.isFinite(Number(raw.delayHours)) && Number(raw.delayHours) > 0
      ? Math.min(168, Math.max(1, Math.floor(Number(raw.delayHours))))
      : null;

  const cartEmailDelays = normalizeDelayList(
    raw.cartEmailDelays,
    CART_EMAIL_DELAY_OPTIONS,
    legacyDelay && CART_EMAIL_DELAY_OPTIONS.includes(legacyDelay)
      ? [legacyDelay]
      : DEFAULT_ABANDONED_CART_SETTINGS.cartEmailDelays
  );

  const delayHours = Math.min(...cartEmailDelays);

  // Preferir cartSendMode explícito; sendRecoveryEmail só como legado quando mode não veio.
  let cartSendMode = 'automated';
  if (raw.cartSendMode === 'manual' || raw.cartSendMode === 'automated') {
    cartSendMode = raw.cartSendMode;
  } else if (raw.sendRecoveryEmail === false) {
    cartSendMode = 'manual';
  }

  return {
    enabled: raw.enabled !== false,
    inactivityMinutes,
    delayHours,
    minSubtotalCents:
      Number.isFinite(Number(raw.minSubtotalCents)) && Number(raw.minSubtotalCents) >= 0
        ? Math.floor(Number(raw.minSubtotalCents))
        : DEFAULT_ABANDONED_CART_SETTINGS.minSubtotalCents,
    sendRecoveryEmail: cartSendMode === 'automated',
    notificationWindowStart: parseTimeHHmm(
      raw.notificationWindowStart,
      DEFAULT_ABANDONED_CART_SETTINGS.notificationWindowStart
    ),
    notificationWindowEnd: parseTimeHHmm(
      raw.notificationWindowEnd,
      DEFAULT_ABANDONED_CART_SETTINGS.notificationWindowEnd
    ),
    cartSendMode,
    whatsappCartMessage:
      typeof raw.whatsappCartMessage === 'string' && raw.whatsappCartMessage.trim()
        ? raw.whatsappCartMessage.trim()
        : DEFAULT_WHATSAPP_CART,
    whatsappOrderMessage:
      typeof raw.whatsappOrderMessage === 'string' && raw.whatsappOrderMessage.trim()
        ? raw.whatsappOrderMessage.trim()
        : DEFAULT_WHATSAPP_ORDER,
    cartEmailDelays,
    abandonedProductEnabled: raw.abandonedProductEnabled === true,
    abandonedProductDelays: normalizeDelayList(
      raw.abandonedProductDelays,
      PRODUCT_EMAIL_DELAY_OPTIONS,
      DEFAULT_ABANDONED_CART_SETTINGS.abandonedProductDelays
    ),
    cancelledOrderEnabled: raw.cancelledOrderEnabled === true,
    cancelledOrderDelays: normalizeDelayList(
      raw.cancelledOrderDelays,
      CANCELLED_ORDER_DELAY_OPTIONS,
      DEFAULT_ABANDONED_CART_SETTINGS.cancelledOrderDelays
    ),
  };
}

async function getAbandonedCartSettings(prisma) {
  const config = await prisma.siteConfig.findUnique({
    where: { id: 'default' },
    select: { abandonedCartSettings: true },
  });
  return normalizeAbandonedCartSettings(config?.abandonedCartSettings);
}

async function saveAbandonedCartSettings(prisma, input) {
  const normalized = normalizeAbandonedCartSettings({
    ...((await getAbandonedCartSettings(prisma)) || {}),
    ...(input && typeof input === 'object' ? input : {}),
  });

  // Sempre alinhar delayHours ao menor intervalo ativo do carrinho
  normalized.delayHours = Math.min(...normalized.cartEmailDelays);
  normalized.sendRecoveryEmail = normalized.cartSendMode === 'automated';

  await prisma.siteConfig.upsert({
    where: { id: 'default' },
    create: { id: 'default', abandonedCartSettings: normalized },
    update: { abandonedCartSettings: normalized },
  });

  return normalized;
}

function getInactivityCutoff(settings = DEFAULT_ABANDONED_CART_SETTINGS, now = new Date()) {
  const minutes = settings.inactivityMinutes || DEFAULT_ABANDONED_CART_SETTINGS.inactivityMinutes;
  return new Date(now.getTime() - minutes * 60 * 1000);
}

function getEmailDelayCutoff(settings = DEFAULT_ABANDONED_CART_SETTINGS, now = new Date()) {
  const hours =
    Array.isArray(settings.cartEmailDelays) && settings.cartEmailDelays.length
      ? Math.min(...settings.cartEmailDelays)
      : settings.delayHours || DEFAULT_ABANDONED_CART_SETTINGS.delayHours;
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

/** Retorna true se o horário atual (fuso America/Sao_Paulo) está na janela de envio. */
function isWithinNotificationWindow(settings = DEFAULT_ABANDONED_CART_SETTINGS, now = new Date()) {
  const start = parseTimeHHmm(
    settings.notificationWindowStart,
    DEFAULT_ABANDONED_CART_SETTINGS.notificationWindowStart
  );
  const end = parseTimeHHmm(
    settings.notificationWindowEnd,
    DEFAULT_ABANDONED_CART_SETTINGS.notificationWindowEnd
  );

  let hhmm;
  try {
    hhmm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    hhmm = `${h}:${m}`;
  }

  if (start <= end) {
    return hhmm >= start && hhmm <= end;
  }
  // Janela atravessa meia-noite (ex.: 22:00–06:00)
  return hhmm >= start || hhmm <= end;
}

module.exports = {
  DEFAULT_ABANDONED_CART_SETTINGS,
  DEFAULT_WHATSAPP_CART,
  DEFAULT_WHATSAPP_ORDER,
  CART_EMAIL_DELAY_OPTIONS,
  PRODUCT_EMAIL_DELAY_OPTIONS,
  CANCELLED_ORDER_DELAY_OPTIONS,
  normalizeAbandonedCartSettings,
  getAbandonedCartSettings,
  saveAbandonedCartSettings,
  getInactivityCutoff,
  getEmailDelayCutoff,
  isWithinNotificationWindow,
};
