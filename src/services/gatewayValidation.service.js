const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { createEfiInstance } = require('../config/efi.config');
const {
  getPagBankCredentials,
  pagBankAuthHeaders,
  isPagBankAuthError,
  SANDBOX_BASE_URL,
} = require('../config/pagbank.config');
const { isGatewaySandbox } = require('../utils/gatewaySandbox');

const { unlockGatewayConfig } = require('../utils/gatewaySecrets');

const PIX_GATEWAY_SLUGS = ['efi-bank', 'mercado-pago', 'pagbank'];

const EFI_COBRANCAS_SANDBOX = 'https://cobrancas-h.api.efipay.com.br/v1';
const EFI_COBRANCAS_PRODUCTION = 'https://cobrancas.api.efipay.com.br/v1';
const EFI_PIX_SANDBOX = 'https://pix-h.api.efipay.com.br';
const EFI_PIX_PRODUCTION = 'https://pix.api.efipay.com.br';

/**
 * Materializa .p12 em tmp só quando path é inevitável (sem Base64).
 * Permissões 0o600; preferir getEfiPfxBuffer / certificateBase64 em memória.
 */
function resolveEfiCertificate(config) {
  const unlocked = unlockGatewayConfig(config || {});
  if (unlocked.certificatePath) {
    return path.isAbsolute(unlocked.certificatePath)
      ? unlocked.certificatePath
      : path.resolve(__dirname, '../../', unlocked.certificatePath);
  }
  if (unlocked.certificateBase64) {
    const raw = String(unlocked.certificateBase64).replace(/\s+/g, '');
    const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
    const certPath = path.join(os.tmpdir(), `efi-cert-${hash}.p12`);
    try {
      if (!fs.existsSync(certPath)) {
        fs.writeFileSync(certPath, Buffer.from(raw, 'base64'), { mode: 0o600 });
      } else {
        fs.chmodSync(certPath, 0o600);
      }
    } catch (err) {
      console.error('[resolveEfiCertificate] falha ao gravar tmp:', err.message);
      throw new Error('Não foi possível preparar o certificado Efí');
    }
    return certPath;
  }
  if (process.env.EFI_CERT_PATH) {
    return path.resolve(__dirname, '../../', process.env.EFI_CERT_PATH);
  }
  return undefined;
}

function getEfiPfxBuffer(config) {
  const unlocked = unlockGatewayConfig(config || {});
  if (unlocked.certificateBase64) {
    return Buffer.from(String(unlocked.certificateBase64).replace(/\s+/g, ''), 'base64');
  }
  const certPath = resolveEfiCertificate(unlocked);
  if (certPath && fs.existsSync(certPath)) {
    return fs.readFileSync(certPath);
  }
  return null;
}

/** Executa fn com path tmp e remove o arquivo se foi criado nesta chamada. */
async function withEfiTempCertificate(config, fn) {
  const unlocked = unlockGatewayConfig(config || {});
  let createdTmp = false;
  let certPath;
  if (!unlocked.certificatePath && unlocked.certificateBase64) {
    const raw = String(unlocked.certificateBase64).replace(/\s+/g, '');
    const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
    certPath = path.join(os.tmpdir(), `efi-cert-once-${hash}-${process.pid}.p12`);
    fs.writeFileSync(certPath, Buffer.from(raw, 'base64'), { mode: 0o600 });
    createdTmp = true;
  } else {
    certPath = resolveEfiCertificate(unlocked);
  }
  try {
    return await fn(certPath, unlocked);
  } finally {
    if (createdTmp && certPath) {
      try {
        fs.unlinkSync(certPath);
      } catch {
        /* ignore */
      }
    }
  }
}

function formatEfiValidationError(err) {
  if (typeof err === 'string' && err.trim()) return err.trim();

  const data = err?.response?.data || err;
  const desc = data?.error_description ?? data?.mensagem ?? data?.message ?? data?.nome;

  if (typeof desc === 'string' && desc.trim()) return desc.trim();
  if (desc && typeof desc === 'object') {
    if (typeof desc.message === 'string') return desc.message;
    if (typeof desc.property === 'string') return `Parâmetro inválido: ${desc.property}`;
    try {
      return JSON.stringify(desc);
    } catch {
      /* ignore */
    }
  }

  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  if (typeof err?.message === 'string' && err.message.trim() && err.message !== '[object Object]') {
    return err.message.trim();
  }
  if (err?.code) return String(err.code);

  try {
    return JSON.stringify(data || err);
  } catch {
    return 'Falha ao validar credenciais Efí Bank.';
  }
}

async function validateEfiCobrancasAuth(clientId, clientSecret, sandbox) {
  const baseUrl = sandbox ? EFI_COBRANCAS_SANDBOX : EFI_COBRANCAS_PRODUCTION;
  const { data } = await axios.post(
    `${baseUrl}/authorize`,
    { grant_type: 'client_credentials' },
    {
      auth: { username: clientId, password: clientSecret },
      timeout: 15000,
    }
  );
  if (!data?.access_token) {
    throw new Error('Não foi possível obter token da API Cobranças.');
  }
}

/**
 * OAuth Pix exige mTLS com o .p12 da MESMA aplicação/ambiente.
 * Sem certificado (ou cert errado) a Efí costuma responder 500 "Erro interno do servidor".
 */
async function validateEfiPixOauth(clientId, clientSecret, pfxBuffer, sandbox) {
  if (!pfxBuffer || pfxBuffer.length < 100) {
    throw new Error('Certificado .p12 inválido ou vazio.');
  }

  let agent;
  try {
    agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: '',
      rejectUnauthorized: true,
    });
  } catch (err) {
    throw new Error(
      `Não foi possível ler o .p12 (${err.message}). Exporte novamente o certificado no painel Efí.`
    );
  }

  const baseUrl = sandbox ? EFI_PIX_SANDBOX : EFI_PIX_PRODUCTION;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const { data, status } = await axios.post(
      `${baseUrl}/oauth/token`,
      { grant_type: 'client_credentials' },
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
        validateStatus: () => true,
      }
    );

    if (status >= 200 && status < 300 && data?.access_token) {
      return data.access_token;
    }

    const apiMsg = formatEfiValidationError({ response: { data } });
    const err = new Error(apiMsg || `OAuth Pix HTTP ${status}`);
    err.status = status;
    err.body = data;
    throw err;
  } catch (err) {
    if (err.status) throw err;
    const code = err.code || err.cause?.code || '';
    if (code === 'ECONNRESET' || /socket hang up/i.test(err.message || '')) {
      throw new Error(
        'Conexão Pix encerrada (certificado/ambiente incompatível). Reenvie o .p12 da aba Homologação da MESMA aplicação do Client ID.'
      );
    }
    throw err;
  }
}

async function validateEfiBank(config = {}) {
  const clientId = config.clientId || config.client_id;
  const clientSecret = config.clientSecret || config.client_secret;
  const pixKey = config.pixKey || config.pix_key;
  const sandbox = isGatewaySandbox(config);

  if (!clientId || !clientSecret) {
    return { valid: false, message: 'Client ID e Client Secret são obrigatórios.' };
  }
  if (!pixKey) {
    return { valid: false, message: 'Chave PIX é obrigatória (cadastre uma chave EVP/aleatória no painel Efí).' };
  }

  const pfxBuffer = getEfiPfxBuffer(config);
  if (!pfxBuffer) {
    return { valid: false, message: 'Certificado .p12 é obrigatório para a Efí Bank (API Pix).' };
  }

  try {
    await validateEfiCobrancasAuth(clientId, clientSecret, sandbox);
  } catch (err) {
    const raw = formatEfiValidationError(err);
    console.error('[validateEfiBank] Cobranças auth failed:', raw, err?.response?.status || '');
    return {
      valid: false,
      message: sandbox
        ? `API Cobranças: ${raw}. Confira Client ID/Secret da aba Homologação.`
        : `API Cobranças: ${raw}. Confira Client ID/Secret de Produção.`,
    };
  }

  try {
    await validateEfiPixOauth(clientId, clientSecret, pfxBuffer, sandbox);
  } catch (err) {
    const raw = formatEfiValidationError(err);
    console.error('[validateEfiBank] Pix OAuth failed:', {
      status: err.status,
      message: raw,
      body: err.body,
      sandbox,
      clientIdPrefix: String(clientId).slice(0, 24),
      pfxBytes: pfxBuffer.length,
    });

    if (/erro interno/i.test(raw) || err.status === 500) {
      return {
        valid: false,
        message:
          'Client ID/Secret OK, mas o certificado .p12 não autentica na API Pix. '
          + 'Isso quase sempre é .p12 de outra aplicação/ambiente. '
          + 'Baixe o .p12 em Meus certificados → Homologação (app do mesmo Client ID) e reenvie no dialog — não reutilize o certificado antigo já salvo.',
      };
    }

    return { valid: false, message: `API Pix: ${raw}` };
  }

  try {
    const efi = createEfiInstance({
      clientId,
      clientSecret,
      sandbox,
      certificateBase64: config.certificateBase64 || pfxBuffer.toString('base64'),
    });
    try {
      await efi.getAccountBalance();
    } catch {
      await efi.pixListEvp();
    }
  } catch (err) {
    console.warn('[validateEfiBank] Pix probe after OAuth:', formatEfiValidationError(err));
  }

  return {
    valid: true,
    message: sandbox
      ? 'Credenciais Efí Bank (Homologação) validadas — Cobranças e Pix OK.'
      : 'Credenciais Efí Bank (Produção) validadas — Cobranças e Pix OK.',
  };
}

async function validateMercadoPago(config = {}) {
  const accessToken = config.accessToken || config.access_token;
  if (!accessToken) {
    return { valid: false, message: 'Access Token é obrigatório.' };
  }

  try {
    const { data } = await axios.get('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });
    return {
      valid: true,
      message: `Credenciais Mercado Pago válidas${data.nickname ? ` (${data.nickname})` : ''}.`,
    };
  } catch (err) {
    const msg = err?.response?.data?.message || err?.message || 'Access Token inválido.';
    return { valid: false, message: msg };
  }
}

async function probePagBankToken(baseUrl, token) {
  try {
    await axios.get(`${baseUrl}/orders`, {
      headers: pagBankAuthHeaders(token),
      params: { limit: 1 },
      timeout: 15000,
    });
  } catch (err) {
    const errorBody = err?.response?.data;
    const isAuthError = err?.response?.status === 401 || 
                       errorBody?.error_messages?.[0]?.error === 'invalid_authorization_header';
    
    if (isAuthError) throw err;
    
    // If it's a 400 with "No known parameter" or similar, 
    // it means the token was accepted but the probe request was rejected by PagBank business logic.
    // This is enough to consider the token valid.
    const description = errorBody?.error_messages?.[0]?.description || '';
    if (err?.response?.status === 400 && description.includes('parameter')) {
      return; 
    }
    
    throw err;
  }
}

async function validatePagBank(config = {}) {
  const creds = getPagBankCredentials(config);

  if (creds.hasToken) {
    try {
      await probePagBankToken(creds.baseUrl, creds.token);
      return { valid: true, message: 'Token PagBank validado com sucesso.' };
    } catch (err) {
      if (!creds.sandbox && isPagBankAuthError(err)) {
        try {
          await probePagBankToken(SANDBOX_BASE_URL, creds.token);
          return {
            valid: false,
            message: 'Este token é do ambiente de teste (portaldev.pagbank.com.br). Ative o Modo Sandbox e teste novamente.',
            enforceSandbox: true,
          };
        } catch {
        }
      }

      const msg = err?.response?.data?.error_messages?.[0]?.description
        || err?.response?.data?.message
        || err?.message
        || 'Token PagBank inválido.';
      return { valid: false, message: msg };
    }
  }

  if (!creds.hasOAuth) {
    return { valid: false, message: 'Informe Client ID + Client Secret ou um Access Token.' };
  }

  try {
    const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const { data } = await axios.post(
      `${creds.baseUrl}/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );
    if (!data.access_token) {
      return { valid: false, message: 'Não foi possível obter token de acesso do PagBank.' };
    }
    return { valid: true, message: 'Client ID e Client Secret PagBank validados com sucesso.' };
  } catch (err) {
    const msg = err?.response?.data?.error_description
      || err?.response?.data?.error_messages?.[0]?.description
      || err?.message
      || 'Credenciais PagBank inválidas.';
    return { valid: false, message: msg };
  }
}

async function validateStripe(config = {}) {
  const secretKey = config.secretKey || config.secret_key;
  if (!secretKey) {
    return { valid: false, message: 'Secret Key é obrigatória.' };
  }
  if (!secretKey.startsWith('sk_')) {
    return { valid: false, message: 'Secret Key deve começar com sk_.' };
  }

  try {
    await axios.get('https://api.stripe.com/v1/balance', {
      auth: { username: secretKey, password: '' },
      timeout: 15000,
    });
    return { valid: true, message: 'Secret Key Stripe validada com sucesso.' };
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err?.message || 'Secret Key inválida.';
    return { valid: false, message: msg };
  }
}

async function validateGatewayCredentials(slug, config = {}) {
  switch (slug) {
    case 'efi-bank':
    case 'efi-pix':
      return validateEfiBank(config);
    case 'mercado-pago':
      return validateMercadoPago(config);
    case 'pagbank':
      return validatePagBank(config);
    case 'stripe':
      return validateStripe(config);
    default:
      return { valid: false, message: `Gateway desconhecido: ${slug}` };
  }
}

module.exports = {
  PIX_GATEWAY_SLUGS,
  validateGatewayCredentials,
  resolveEfiCertificate,
  getEfiPfxBuffer,
  withEfiTempCertificate,
};
