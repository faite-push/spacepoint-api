const GATEWAY_SLUGS = ['efi-bank', 'mercado-pago', 'pagbank', 'stripe'];

const GATEWAY_CAPABILITIES = {
  'efi-bank': { methods: ['PIX', 'CARD'], label: 'Efí Bank' },
  'efi-pix': { methods: ['PIX'], label: 'Efí Bank' },
  'mercado-pago': { methods: ['PIX', 'CARD'], label: 'Mercado Pago' },
  pagbank: { methods: ['PIX', 'CARD'], label: 'PagBank' },
  stripe: { methods: ['CARD'], label: 'Stripe' },
};

/** Campos de cliente exigidos por gateway/método (chaves do checkoutData) */
const GATEWAY_CUSTOMER_FIELDS = {
  'efi-bank': { PIX: [], CARD: [] },
  'mercado-pago': { PIX: ['email'], CARD: ['email', 'name'] },
  pagbank: { PIX: ['name', 'email', 'cpf'], CARD: ['name', 'email', 'cpf'] },
  stripe: { PIX: ['email', 'name'], CARD: ['email', 'name'] },
};

function normalizeSlug(slug) {
  return slug === 'efi-pix' ? 'efi-bank' : slug;
}

function getGatewayRequiredFields(slug, method) {
  const key = normalizeSlug(slug);
  const normalizedMethod = String(method || 'PIX').trim().toUpperCase();
  const map = GATEWAY_CUSTOMER_FIELDS[key] || {};
  return map[normalizedMethod] || [];
}

function getRequiredFieldsForCheckout(pixGatewaySlug, cardGatewaySlug, paymentMethod) {
  const method = String(paymentMethod || 'PIX').trim().toUpperCase();
  const slug = method === 'CARD' ? cardGatewaySlug : pixGatewaySlug;
  if (!slug) return [];
  return getGatewayRequiredFields(slug, method);
}

function getSupportedMethods(slug) {
  const key = normalizeSlug(slug);
  return GATEWAY_CAPABILITIES[key]?.methods || ['PIX'];
}

function supportsMethod(slug, method) {
  return getSupportedMethods(slug).includes(String(method || '').toUpperCase());
}

function getGatewayActiveMethods(gateway) {
  const slug = normalizeSlug(gateway?.slug);
  const supported = getSupportedMethods(slug);
  const activeMethods = gateway?.config?.activeMethods;

  if (activeMethods && typeof activeMethods === 'object') {
    return {
      PIX: supported.includes('PIX') && Boolean(activeMethods.PIX),
      CARD: supported.includes('CARD') && Boolean(activeMethods.CARD),
    };
  }

  const legacy = Array.isArray(gateway?.config?.paymentMethods)
    ? gateway.config.paymentMethods.map((m) => String(m).toUpperCase())
    : [];

  if (gateway?.isActive && legacy.length) {
    return {
      PIX: supported.includes('PIX') && legacy.includes('PIX'),
      CARD: supported.includes('CARD') && legacy.includes('CARD'),
    };
  }

  return { PIX: false, CARD: false };
}

function hasAnyActiveMethod(gateway) {
  const active = getGatewayActiveMethods(gateway);
  return active.PIX || active.CARD;
}

module.exports = {
  GATEWAY_SLUGS,
  GATEWAY_CAPABILITIES,
  GATEWAY_CUSTOMER_FIELDS,
  normalizeSlug,
  getSupportedMethods,
  supportsMethod,
  getGatewayActiveMethods,
  hasAnyActiveMethod,
  getGatewayRequiredFields,
  getRequiredFieldsForCheckout,
};
