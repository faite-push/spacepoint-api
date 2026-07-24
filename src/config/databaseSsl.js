const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CERTS_DIR = path.join(__dirname, '..', 'certs');
const DEFAULT_PEM_PATH = path.join(CERTS_DIR, 'certificate.pem');
const DEFAULT_P12_PATH = path.join(CERTS_DIR, 'client.p12');
const DEFAULT_KEY_PATH = path.join(CERTS_DIR, 'client.key');
const DEFAULT_CERT_PATH = path.join(CERTS_DIR, 'client.crt');

/**
 * SquareCloud Postgres + Prisma: preferir PKCS#12 (sslidentity).
 * Gera client.p12 a partir do PEM via openssl quando disponível.
 *
 * Env:
 * - DATABASE_URL
 * - DATABASE_SSL_CERT / DATABASE_SSL_CERT_BASE64 / DATABASE_SSL_CERT_PATH
 * - DATABASE_SSL_P12_PATH / DATABASE_SSL_P12_PASSWORD
 * - DATABASE_SSL_MODE (require | no-verify | verify-ca | verify-full)
 */

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function pathForUrl(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/');
}

function decodeCertContent() {
  const raw = process.env.DATABASE_SSL_CERT;
  if (raw && String(raw).trim()) {
    return String(raw).replace(/\\n/g, '\n').trim();
  }
  const b64 = process.env.DATABASE_SSL_CERT_BASE64;
  if (b64 && String(b64).trim()) {
    return Buffer.from(String(b64).trim(), 'base64').toString('utf8').trim();
  }
  return null;
}

function splitPemBundles(pemContent, outDir) {
  ensureDir(outDir);
  const keyMatch = pemContent.match(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/
  );
  const certMatches = [...pemContent.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)];

  if (keyMatch) {
    fs.writeFileSync(DEFAULT_KEY_PATH, `${keyMatch[0].trim()}\n`, 'utf8');
  }
  if (certMatches.length) {
    fs.writeFileSync(
      DEFAULT_CERT_PATH,
      `${certMatches.map((m) => m[0].trim()).join('\n')}\n`,
      'utf8'
    );
  }

  return {
    keyPath: fs.existsSync(DEFAULT_KEY_PATH) ? DEFAULT_KEY_PATH : null,
    certPath: fs.existsSync(DEFAULT_CERT_PATH) ? DEFAULT_CERT_PATH : null,
  };
}

function resolvePemPath() {
  const fromEnv = process.env.DATABASE_SSL_CERT_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);

  const content = decodeCertContent();
  if (content) {
    ensureDir(CERTS_DIR);
    fs.writeFileSync(DEFAULT_PEM_PATH, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
    return DEFAULT_PEM_PATH;
  }

  if (fs.existsSync(DEFAULT_PEM_PATH)) return DEFAULT_PEM_PATH;

  const rootPem = path.join(process.cwd(), 'certificate.pem');
  if (fs.existsSync(rootPem)) return rootPem;

  return null;
}

function tryCreateP12(keyPath, certPath) {
  if (!keyPath || !certPath) return null;
  if (fs.existsSync(DEFAULT_P12_PATH)) return DEFAULT_P12_PATH;

  const password = process.env.DATABASE_SSL_P12_PASSWORD || 'squarecloud';
  ensureDir(CERTS_DIR);

  const result = spawnSync(
    'openssl',
    [
      'pkcs12',
      '-export',
      '-out',
      DEFAULT_P12_PATH,
      '-inkey',
      keyPath,
      '-in',
      certPath,
      '-passout',
      `pass:${password}`,
    ],
    { encoding: 'utf8' }
  );

  if (result.status === 0 && fs.existsSync(DEFAULT_P12_PATH)) {
    console.log('[databaseSsl] client.p12 gerado via openssl');
    return DEFAULT_P12_PATH;
  }

  const err = (result.stderr || result.error || '').toString().trim();
  if (err) console.warn('[databaseSsl] openssl p12:', err.slice(0, 200));
  return null;
}

function resolveP12Path(keyPath, certPath) {
  const fromEnv = process.env.DATABASE_SSL_P12_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);

  const rootP12 = path.join(process.cwd(), 'client.p12');
  if (fs.existsSync(rootP12)) return rootP12;
  if (fs.existsSync(DEFAULT_P12_PATH)) return DEFAULT_P12_PATH;

  return tryCreateP12(keyPath, certPath);
}

function stripSslParams(databaseUrl) {
  const url = new URL(databaseUrl);
  for (const key of [
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'sslidentity',
    'sslpassword',
  ]) {
    url.searchParams.delete(key);
  }
  return url.toString();
}

function appendQueryParams(databaseUrl, params) {
  const url = new URL(databaseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function sanitizeUrlForLog(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(url inválida)';
  }
}

/**
 * Aplica SSL na process.env.DATABASE_URL. Idempotente.
 */
function applyDatabaseSsl() {
  let baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    return { url: '', mode: 'none' };
  }

  // Reaplica do zero para preferir p12 quando possível
  baseUrl = stripSslParams(baseUrl);

  // Garante path do database (Square costuma usar /squarecloud)
  try {
    const u = new URL(baseUrl);
    if (!u.pathname || u.pathname === '/') {
      u.pathname = '/squarecloud';
      baseUrl = u.toString();
    }
  } catch {
    /* ignore */
  }

  const sslMode = process.env.DATABASE_SSL_MODE || 'no-verify';

  const pemPath = resolvePemPath();
  let keyPath = null;
  let certPath = null;
  if (pemPath) {
    const pemContent = fs.readFileSync(pemPath, 'utf8');
    ({ keyPath, certPath } = splitPemBundles(pemContent, CERTS_DIR));
  }

  const p12Path = resolveP12Path(keyPath, certPath);
  if (p12Path) {
    const password = process.env.DATABASE_SSL_P12_PASSWORD || 'squarecloud';
    const url = appendQueryParams(baseUrl, {
      sslmode: sslMode,
      sslidentity: pathForUrl(p12Path),
      sslpassword: password,
      schema: 'public',
    });
    process.env.DATABASE_URL = url;
    return { url, mode: 'p12' };
  }

  if (pemPath) {
    const key = pathForUrl(keyPath || pemPath);
    const cert = pathForUrl(certPath || pemPath);
    const params = {
      sslmode: sslMode,
      sslcert: cert,
      sslkey: key,
      schema: 'public',
    };
    if (sslMode === 'verify-ca' || sslMode === 'verify-full') {
      params.sslrootcert = cert;
    }
    const url = appendQueryParams(baseUrl, params);
    process.env.DATABASE_URL = url;
    return { url, mode: 'pem' };
  }

  process.env.DATABASE_URL = baseUrl;
  return { url: baseUrl, mode: 'none' };
}

const applied = applyDatabaseSsl();
if (process.env.NODE_ENV !== 'test' && applied.mode !== 'none') {
  console.log(`[databaseSsl] TLS ativo (${applied.mode})`);
  console.log(`[databaseSsl] ${sanitizeUrlForLog(applied.url)}`);
}

module.exports = {
  applyDatabaseSsl,
  resolvePemPath,
  resolveP12Path,
  sanitizeUrlForLog,
  CERTS_DIR,
  DEFAULT_PEM_PATH,
  DEFAULT_P12_PATH,
};
