const { prisma } = require('../config/prisma');

/**
 * Retorna a config de um plugin habilitado, ou null.
 */
async function getEnabledPluginConfig(pluginId) {
  const site = await prisma.siteConfig.findUnique({
    where: { id: 'default' },
    select: { pluginsConfig: true },
  });

  const entry = site?.pluginsConfig?.[pluginId];
  if (!entry || entry.enabled !== true) return null;

  const config =
    entry.config && typeof entry.config === 'object' && !Array.isArray(entry.config)
      ? entry.config
      : {};

  return config;
}

module.exports = {
  getEnabledPluginConfig,
};
