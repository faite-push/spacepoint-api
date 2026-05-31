/**
 * CSRF Middleware — Double-Submit Cookie Pattern
 *
 * O servidor seta `csrf_token` (não-httpOnly) após o login.
 * O frontend lê esse cookie e envia no header `X-CSRF-Token`.
 * Este middleware verifica que os dois valores coincidem.
 *
 * Aplicar APENAS em mutations (POST, PUT, PATCH, DELETE).
 */
const csrf = (req, res, next) => {
  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'CSRF token ausente' });
  }

  if (cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF token inválido' });
  }

  next();
};

module.exports = csrf;
