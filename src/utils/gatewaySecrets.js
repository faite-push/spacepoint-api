const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const STORED_PLACEHOLDER = '__STORED__';

function encryptionKey() {
  const secret = process.env.GATEWAY_ENCRYPTION_KEY || process.env.JWT_SECRET || 'spacepoint-dev-insecure';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/** Criptografa segredo em repouso (AES-256-GCM). Idempotente se já criptografado. */
function sealSecret(plain) {
  const value = String(plain || '').replace(/\s+/g, '');
  if (!value || value.startsWith(PREFIX) || value === STORED_PLACEHOLDER) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

/** Descriptografa; valores legados em claro passam direto. */
function openSecret(value) {
  const raw = String(value || '');
  if (!raw || raw === STORED_PLACEHOLDER || !raw.startsWith(PREFIX)) return raw;

  try {
    const payload = raw.slice(PREFIX.length);
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return raw;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivB64, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    console.error('[gatewaySecrets] falha ao abrir certificado:', err.message);
    throw new Error('Não foi possível ler o certificado armazenado. Reenvie o .p12.');
  }
}

function redactGatewayConfigForClient(config) {
  if (!config || typeof config !== 'object') return config || {};
  const next = { ...config };
  if (next.certificateBase64) {
    next.certificateBase64 = STORED_PLACEHOLDER;
  }
  return next;
}

/**
 * Prepara config para gravar no DB: mantém cert existente se placeholder,
 * criptografa novo .p12 em Base64.
 */
function prepareGatewayConfigForStorage(incoming, existingConfig = {}) {
  const next = { ...(incoming || {}) };
  const incomingCert = next.certificateBase64;

  if (
    incomingCert === undefined
    || incomingCert === null
    || incomingCert === ''
    || incomingCert === STORED_PLACEHOLDER
  ) {
    if (existingConfig.certificateBase64) {
      next.certificateBase64 = existingConfig.certificateBase64;
    } else {
      delete next.certificateBase64;
    }
  } else {
    next.certificateBase64 = sealSecret(incomingCert);
  }

  return next;
}

/** Config pronta para uso na Efí (cert descriptografado). */
function unlockGatewayConfig(config) {
  if (!config || typeof config !== 'object') return {};
  if (!config.certificateBase64 || config.certificateBase64 === STORED_PLACEHOLDER) {
    return { ...config };
  }
  return {
    ...config,
    certificateBase64: openSecret(config.certificateBase64),
  };
}

module.exports = {
  STORED_PLACEHOLDER,
  sealSecret,
  openSecret,
  redactGatewayConfigForClient,
  prepareGatewayConfigForStorage,
  unlockGatewayConfig,
};
