const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createEfiInstance } = require('../config/efi.config');
const {
  getPagBankCredentials,
  pagBankAuthHeaders,
  isPagBankAuthError,
  SANDBOX_BASE_URL,
} = require('../config/pagbank.config');

const PIX_GATEWAY_SLUGS = ['efi-bank', 'mercado-pago', 'pagbank', 'stripe'];

function resolveEfiCertificate(config) {
  if (config.certificatePath) {
    return path.resolve(__dirname, '../../', config.certificatePath);
  }
  if (config.certificateBase64) {
    const hash = crypto.createHash('sha256').update(config.certificateBase64).digest('hex').slice(0, 16);
    const certPath = path.join(os.tmpdir(), `efi-cert-${hash}.p12`);
    if (!fs.existsSync(certPath)) {
      fs.writeFileSync(certPath, Buffer.from(config.certificateBase64, 'base64'));
    }
    return certPath;
  }
  if (process.env.EFI_CERT_PATH) {
    return path.resolve(__dirname, '../../', process.env.EFI_CERT_PATH);
  }
  return undefined;
}

async function validateEfiBank(config = {}) {
  const clientId = config.clientId || config.client_id;
  const clientSecret = config.clientSecret || config.client_secret;
  const pixKey = config.pixKey || config.pix_key;

  if (!clientId || !clientSecret) {
    return { valid: false, message: 'Client ID e Client Secret são obrigatórios.' };
  }
  if (!pixKey) {
    return { valid: false, message: 'Chave PIX é obrigatória.' };
  }

  const certificate = resolveEfiCertificate(config);
  if (!certificate) {
    return { valid: false, message: 'Certificado .p12 é obrigatório para a Efí Bank.' };
  }

  try {
    const efi = createEfiInstance({
      clientId,
      clientSecret,
      sandbox: config.sandbox !== false,
      certificatePath: certificate,
    });
    await efi.pixListEvp();
    return { valid: true, message: 'Credenciais Efí Bank validadas com sucesso.' };
  } catch (err) {
    const msg = err?.response?.data?.mensagem || err?.message || 'Falha ao validar credenciais Efí Bank.';
    return { valid: false, message: msg };
  }
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
  await axios.get(`${baseUrl}/orders`, {
    headers: pagBankAuthHeaders(token),
    params: { limit: 1, offset: 0 },
    timeout: 15000,
  });
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
};
