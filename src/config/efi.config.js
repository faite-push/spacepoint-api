const EfiPay = require('sdk-node-apis-efi');
const path = require('path');

function resolveCertPath(certPath) {
  if (!certPath) return undefined;
  return path.isAbsolute(certPath) ? certPath : path.resolve(__dirname, '../../', certPath);
}

function createEfiInstance(dynamicOptions = {}) {
  const sandbox = dynamicOptions.sandbox !== undefined
    ? dynamicOptions.sandbox
    : (dynamicOptions.env === 'production' ? false : process.env.EFI_ENV !== 'production');

  const options = {
    sandbox,
    client_id: dynamicOptions.clientId || dynamicOptions.client_id || process.env.EFI_CLIENT_ID,
    client_secret: dynamicOptions.clientSecret || dynamicOptions.client_secret || process.env.EFI_CLIENT_SECRET,
  };

  // Preferir base64 direto (evita problemas de path/cache do .p12 no Windows)
  const base64 = dynamicOptions.certificateBase64 || dynamicOptions.certificate_base64;
  if (base64) {
    options.certificate = String(base64).replace(/\s+/g, '');
    options.cert_base64 = true;
  } else {
    const certInput = dynamicOptions.certificatePath || process.env.EFI_CERT_PATH;
    const resolvedCertPath = resolveCertPath(certInput);
    if (resolvedCertPath) {
      options.certificate = resolvedCertPath;
      options.cert_base64 = false;
    }
  }

  return new EfiPay(options);
}

module.exports = { createEfiInstance };
