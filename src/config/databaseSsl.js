const fs = require('fs');
const path = require('path');

const CERTS_DIR = path.join(__dirname, '..', 'certs');
const DEFAULT_PEM_PATH = path.join(CERTS_DIR, 'certificate.pem');
const DEFAULT_P12_PATH = path.join(CERTS_DIR, 'client.p12');

/**
 * SquareCloud Postgres exige TLS. Este módulo materializa o certificado
 * (arquivo ou env) e injeta os parâmetros SSL na DATABASE_URL antes do Prisma.
 *
 * Env suportadas:
 * - DATABASE_URL                  URL base (sem ou com params SSL)
 * - DATABASE_SSL_CERT             Conteúdo PEM (texto completo)
 * - DATABASE_SSL_CERT_BASE64      PEM em base64 (retorno da API Square)
 * - DATABASE_SSL_CERT_PATH        Caminho para certificate.pem já no disco
 * - DATABASE_SSL_P12_PATH         Caminho para client.p12 (preferido pelo Prisma)
 * - DATABASE_SSL_P12_PASSWORD     Senha do .p12 (padrão: squarecloud)
 * - DATABASE_SSL_MODE             verify-ca | require | verify-full (padrão: verify-ca)
 */

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function pathForUrl(filePath) {
  // libpq/Prisma aceitam caminho absoluto; normaliza separadores
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

  // Raiz do projeto (útil no zip da Square)
  const rootPem = path.join(process.cwd(), 'certificate.pem');
  if (fs.existsSync(rootPem)) return rootPem;

  return null;
}

function resolveP12Path() {
  const fromEnv = process.env.DATABASE_SSL_P12_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);
  if (fs.existsSync(DEFAULT_P12_PATH)) return DEFAULT_P12_PATH;
  const rootP12 = path.join(process.cwd(), 'client.p12');
  if (fs.existsSync(rootP12)) return rootP12;
  return null;
}

function appendQueryParams(databaseUrl, params) {
  const url = new URL(databaseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Aplica SSL na process.env.DATABASE_URL. Idempotente.
 * @returns {{ url: string, mode: 'p12'|'pem'|'none' }}
 */
function applyDatabaseSsl() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    return { url: '', mode: 'none' };
  }

  // Já configurado manualmente
  if (
    baseUrl.includes('sslidentity=') ||
    baseUrl.includes('sslrootcert=') ||
    baseUrl.includes('sslcert=')
  ) {
    return { url: baseUrl, mode: baseUrl.includes('sslidentity=') ? 'p12' : 'pem' };
  }

  const sslMode = process.env.DATABASE_SSL_MODE || 'verify-ca';
  const p12Path = resolveP12Path();

  if (p12Path) {
    const password = process.env.DATABASE_SSL_P12_PASSWORD || 'squarecloud';
    const url = appendQueryParams(baseUrl, {
      sslmode: sslMode,
      sslidentity: pathForUrl(p12Path),
      sslpassword: password,
    });
    process.env.DATABASE_URL = url;
    return { url, mode: 'p12' };
  }

  const pemPath = resolvePemPath();
  if (pemPath) {
    const cert = pathForUrl(pemPath);
    // SquareCloud: o mesmo .pem serve como key, cert e CA
    const url = appendQueryParams(baseUrl, {
      sslmode: sslMode,
      sslcert: cert,
      sslkey: cert,
      sslrootcert: cert,
    });
    process.env.DATABASE_URL = url;
    return { url, mode: 'pem' };
  }

  return { url: baseUrl, mode: 'none' };
}

// Auto-aplica ao ser carregado via `node -r`
const applied = applyDatabaseSsl();
if (process.env.NODE_ENV !== 'test' && applied.mode !== 'none') {
  console.log(`[databaseSsl] TLS ativo (${applied.mode})`);
}

module.exports = {
  applyDatabaseSsl,
  resolvePemPath,
  resolveP12Path,
  CERTS_DIR,
  DEFAULT_PEM_PATH,
  DEFAULT_P12_PATH,
};
