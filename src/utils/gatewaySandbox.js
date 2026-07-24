/**
 * Sandbox só quando explícito (true) ou ambiente não-produção sem flag.
 * Em NODE_ENV=production, omitir sandbox = live (não homologação).
 */
function isGatewaySandbox(config = {}) {
  if (config.sandbox === true) return true;
  if (config.sandbox === false) return false;
  return process.env.NODE_ENV !== 'production';
}

module.exports = { isGatewaySandbox };
