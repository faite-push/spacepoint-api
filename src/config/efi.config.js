
const EfiPay = require('sdk-node-apis-efi');
const path = require('path');

const resolvedCertPath = process.env.EFI_CERT_PATH 
    ? path.resolve(__dirname, '../../', process.env.EFI_CERT_PATH)
    : undefined;

const options = {
    sandbox: process.env.EFI_ENV !== 'production',
    client_id: process.env.EFI_CLIENT_ID,
    client_secret: process.env.EFI_CLIENT_SECRET,
    certificate: resolvedCertPath
};

module.exports = new EfiPay(options);