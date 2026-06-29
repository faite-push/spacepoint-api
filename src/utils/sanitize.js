const sanitizeString = (value, maxLength = 500) => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
};

/** Preserva quebras de linha para mensagens de chat */
const sanitizeChatContent = (value, maxLength = 4000) => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLength);
};

const sanitizeSlug = (value) => sanitizeString(value, 120)
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

module.exports = { sanitizeString, sanitizeSlug, sanitizeChatContent };
