
const EfiPay = require('sdk-node-apis-efi');
const path = require('path');

function resolveCertPath(certPath) {
    if (!certPath) return undefined;
    return path.isAbsolute(certPath) ? certPath : path.resolve(__dirname, '../../', certPath);
}

function createEfiInstance(dynamicOptions = {}) {
    const certInput = dynamicOptions.certificatePath || process.env.EFI_CERT_PATH;
    const resolvedCertPath = resolveCertPath(certInput);

    const options = {
        sandbox: dynamicOptions.sandbox !== undefined ? dynamicOptions.sandbox : (dynamicOptions.env === 'production' ? false : process.env.EFI_ENV !== 'production'),
        client_id: dynamicOptions.clientId || dynamicOptions.client_id || process.env.EFI_CLIENT_ID,
        client_secret: dynamicOptions.clientSecret || dynamicOptions.client_secret || process.env.EFI_CLIENT_SECRET,
        certificate: resolvedCertPath
    };

    return new EfiPay(options);
}

module.exports = { createEfiInstance };