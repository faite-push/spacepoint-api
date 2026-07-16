/** Campos persistidos por plugin (allowlist completa, inclui segredos). */
const PLUGIN_FIELDS = {
  'google-ads': ['config', 'send_to'],
  'facebook-pixel': ['pixelId', 'accessToken', 'testEventCode'],
  'tiktok-pixel': ['pixelId', 'accessToken', 'testEventCode'],
  'google-merchant': ['merchantId', 'siteVerification'],
  utmify: ['apiKey'],
  'discord-orders': ['webhookUrl'],
  crisp: ['websiteId'],
  'tawk-to': ['propertyId', 'widgetId'],
  chatwoot: ['baseUrl', 'websiteToken'],
  'google-tag-manager': ['containerId'],
  'google-analytics': ['measurementId'],
};

/**
 * Campos expostos no site-config público (vitrine).
 * Segredos (tokens, webhooks) NÃO entram aqui.
 */
const PLUGIN_PUBLIC_FIELDS = {
  'google-ads': ['config', 'send_to'],
  'facebook-pixel': ['pixelId'],
  'tiktok-pixel': ['pixelId'],
  'google-merchant': ['merchantId', 'siteVerification'],
  utmify: [],
  'discord-orders': [],
  crisp: ['websiteId'],
  'tawk-to': ['propertyId', 'widgetId'],
  chatwoot: ['baseUrl', 'websiteToken'],
  'google-tag-manager': ['containerId'],
  'google-analytics': ['measurementId'],
};

/** Campos sensíveis: mascarados no admin e nunca enviados à vitrine. */
const PLUGIN_SECRET_FIELDS = {
  utmify: ['apiKey'],
  'discord-orders': ['webhookUrl'],
  'facebook-pixel': ['accessToken', 'testEventCode'],
  'tiktok-pixel': ['accessToken', 'testEventCode'],
};

/** Plugins que podem ficar públicos só com `enabled: true` (sem campos). */
const PLUGIN_ALLOW_EMPTY_PUBLIC = new Set(['utmify']);

function maskSecretValue(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••••••${trimmed.slice(-4)}`;
}

function isMaskedSecretValue(value) {
  return typeof value === 'string' && /^•{4,}/.test(value.trim());
}

function sanitizePublicPluginsConfig(pluginsConfig) {
  if (!pluginsConfig || typeof pluginsConfig !== 'object' || Array.isArray(pluginsConfig)) {
    return null;
  }

  const out = {};

  for (const [id, entry] of Object.entries(pluginsConfig)) {
    const allowedKeys = PLUGIN_PUBLIC_FIELDS[id];
    if (!allowedKeys || !entry || typeof entry !== 'object' || entry.enabled !== true) continue;
    if (!entry.config || typeof entry.config !== 'object' || Array.isArray(entry.config)) {
      if (PLUGIN_ALLOW_EMPTY_PUBLIC.has(id)) {
        out[id] = { enabled: true, config: {} };
      }
      continue;
    }

    const sanitizedConfig = {};
    for (const key of allowedKeys) {
      const value = entry.config[key];
      if (typeof value === 'string' && value.trim()) {
        sanitizedConfig[key] = value.trim();
      }
    }

    if (Object.keys(sanitizedConfig).length > 0 || PLUGIN_ALLOW_EMPTY_PUBLIC.has(id)) {
      out[id] = { enabled: true, config: sanitizedConfig };
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

function maskPluginsConfigForAdmin(pluginsConfig) {
  if (!pluginsConfig || typeof pluginsConfig !== 'object' || Array.isArray(pluginsConfig)) {
    return pluginsConfig ?? null;
  }

  const out = {};
  for (const [id, entry] of Object.entries(pluginsConfig)) {
    if (!entry || typeof entry !== 'object') continue;
    const secretKeys = PLUGIN_SECRET_FIELDS[id] || [];
    const config = entry.config && typeof entry.config === 'object' ? { ...entry.config } : {};

    for (const key of secretKeys) {
      if (typeof config[key] === 'string' && config[key].trim()) {
        config[key] = maskSecretValue(config[key]);
      }
    }

    out[id] = {
      enabled: entry.enabled === true || entry.isEnabled === true,
      config,
    };
  }

  return out;
}

module.exports = {
  PLUGIN_FIELDS,
  PLUGIN_PUBLIC_FIELDS,
  PLUGIN_SECRET_FIELDS,
  PLUGIN_ALLOW_EMPTY_PUBLIC,
  sanitizePublicPluginsConfig,
  maskPluginsConfigForAdmin,
  maskSecretValue,
  isMaskedSecretValue,
};
