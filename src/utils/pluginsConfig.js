const {
  PLUGIN_FIELDS,
  PLUGIN_SECRET_FIELDS,
  isMaskedSecretValue,
} = require('./publicPluginsConfig');

const MAX_FIELD_LENGTH = 500;

/**
 * Valida e normaliza pluginsConfig contra a allowlist de plugins/campos.
 * Descarta IDs desconhecidos e valores não-string.
 */
function normalizePluginsConfig(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;

  const out = {};

  for (const [id, entry] of Object.entries(raw)) {
    const allowedKeys = PLUGIN_FIELDS[id];
    if (!allowedKeys) continue;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const rawConfig =
      entry.config && typeof entry.config === 'object' && !Array.isArray(entry.config)
        ? entry.config
        : {};

    const config = {};
    for (const key of allowedKeys) {
      const value = rawConfig[key];
      if (typeof value !== 'string') continue;
      const trimmed = value.trim().slice(0, MAX_FIELD_LENGTH);
      if (trimmed) config[key] = trimmed;
    }

    out[id] = {
      enabled: entry.enabled === true || entry.isEnabled === true,
      config,
    };
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Preserva segredos quando o admin reenvia valor mascarado ou omite o campo.
 */
function mergePreservedPluginSecrets(incoming, previous) {
  if (!incoming || typeof incoming !== 'object') return incoming;

  const prev =
    previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  const out = { ...incoming };

  for (const [id, entry] of Object.entries(out)) {
    const secretKeys = PLUGIN_SECRET_FIELDS[id];
    if (!secretKeys?.length || !entry?.config) continue;

    const prevConfig =
      prev[id]?.config && typeof prev[id].config === 'object' ? prev[id].config : {};
    const nextConfig = { ...entry.config };

    for (const key of secretKeys) {
      const nextVal = nextConfig[key];
      const prevVal = typeof prevConfig[key] === 'string' ? prevConfig[key] : '';

      if (!prevVal) continue;

      if (nextVal === undefined || nextVal === null || nextVal === '') {
        nextConfig[key] = prevVal;
        continue;
      }

      if (isMaskedSecretValue(nextVal)) {
        nextConfig[key] = prevVal;
      }
    }

    out[id] = { ...entry, config: nextConfig };
  }

  return out;
}

module.exports = {
  normalizePluginsConfig,
  mergePreservedPluginSecrets,
  MAX_FIELD_LENGTH,
};
