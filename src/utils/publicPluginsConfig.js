/** Campos de config expostos publicamente por plugin (allowlist). */
const PLUGIN_PUBLIC_FIELDS = {
  'google-ads': ['config', 'send_to'],
  'facebook-pixel': ['pixelId'],
  'tiktok-pixel': ['pixelId'],
  'google-merchant': ['merchantId', 'siteVerification'],
  utmify: ['apiKey'],
  crisp: ['websiteId'],
  'tawk-to': ['propertyId', 'widgetId'],
  chatwoot: ['baseUrl', 'websiteToken'],
  'google-tag-manager': ['containerId'],
  'google-analytics': ['measurementId'],
};

function sanitizePublicPluginsConfig(pluginsConfig) {
  if (!pluginsConfig || typeof pluginsConfig !== 'object' || Array.isArray(pluginsConfig)) {
    return null;
  }

  const out = {};

  for (const [id, entry] of Object.entries(pluginsConfig)) {
    const allowedKeys = PLUGIN_PUBLIC_FIELDS[id];
    if (!allowedKeys || !entry || typeof entry !== 'object' || entry.enabled !== true) continue;
    if (!entry.config || typeof entry.config !== 'object' || Array.isArray(entry.config)) continue;

    const sanitizedConfig = {};
    for (const key of allowedKeys) {
      const value = entry.config[key];
      if (typeof value === 'string' && value.trim()) {
        sanitizedConfig[key] = value.trim();
      }
    }

    if (Object.keys(sanitizedConfig).length > 0) {
      out[id] = { enabled: true, config: sanitizedConfig };
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

module.exports = {
  PLUGIN_PUBLIC_FIELDS,
  sanitizePublicPluginsConfig,
};
