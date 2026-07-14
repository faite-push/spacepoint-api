function resolveCookieSettings() {
  const apiUrl = process.env.API_PUBLIC_URL || process.env.API_URL || '';
  const isLocalHost = /localhost|127\.0\.0\.1/i.test(apiUrl);

  let sameSite = process.env.COOKIE_SAME_SITE
    || (process.env.NODE_ENV === 'production' ? 'none' : 'lax');

  let secure = process.env.COOKIE_SECURE === 'true'
    || (process.env.COOKIE_SECURE !== 'false'
      && (process.env.NODE_ENV === 'production' || sameSite === 'none'));

  if (isLocalHost && process.env.COOKIE_SECURE !== 'true') {
    secure = false;
    if (sameSite === 'none') sameSite = 'lax';
  }

  return {
    httpOnly: true,
    secure,
    sameSite,
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/',
  };
}

const COOKIE_BASE = resolveCookieSettings();

module.exports = { COOKIE_BASE, resolveCookieSettings };