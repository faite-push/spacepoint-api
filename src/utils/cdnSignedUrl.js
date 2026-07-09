const crypto = require('crypto');
const { buildCdnUrl, getPublicApiBaseUrl, extractCdnFilename } = require('./mediaUrl');

const CHAT_FILE_PREFIX = 'chat-';
const CHAT_URL_TTL_SEC = 365 * 24 * 3600;

function getSigningSecret() {
  return process.env.COOKIE_SECRET || process.env.ACCESS_TOKEN_SECRET || '';
}

function signChatFilename(filename, exp) {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(`chat:${filename}:${exp}`)
    .digest('hex');
}

function verifyChatFileSignature(filename, exp, sig) {
  if (!filename || !exp || !sig || !getSigningSecret()) return false;

  const expNum = parseInt(String(exp), 10);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;

  try {
    const expected = Buffer.from(signChatFilename(filename, expNum), 'hex');
    const received = Buffer.from(String(sig), 'hex');
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

function isChatCdnFilename(filename) {
  return typeof filename === 'string' && filename.startsWith(CHAT_FILE_PREFIX);
}

function buildSignedChatCdnUrl(filename, req) {
  const exp = Math.floor(Date.now() / 1000) + CHAT_URL_TTL_SEC;
  const sig = signChatFilename(filename, exp);
  const base = req
    ? buildCdnUrl(filename, req)
    : `${getPublicApiBaseUrl(null)}/cdn/${filename}`;
  return `${base}?exp=${exp}&sig=${sig}`;
}

function signChatFileUrl(fileUrl, req) {
  if (!fileUrl) return fileUrl;
  const filename = extractCdnFilename(fileUrl);
  if (!filename || !isChatCdnFilename(filename)) return fileUrl;
  return buildSignedChatCdnUrl(filename, req);
}

function signChatMessageFileUrls(messages, req) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((message) => {
    if (!message?.fileUrl) return message;
    return {
      ...message,
      fileUrl: signChatFileUrl(message.fileUrl, req),
    };
  });
}

module.exports = {
  CHAT_FILE_PREFIX,
  CHAT_URL_TTL_SEC,
  isChatCdnFilename,
  verifyChatFileSignature,
  buildSignedChatCdnUrl,
  signChatFileUrl,
  signChatMessageFileUrls,
};
