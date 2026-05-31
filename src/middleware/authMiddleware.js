const { verifyToken } = require('../config/jwt');

/**
 * Middleware de autenticação — lê o JWT do httpOnly cookie `access_token`.
 * Nunca do header Authorization (evita XSS via localStorage).
 */
const authenticate = (req, res, next) => {
  const token = req.cookies?.access_token;

  if (!token) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    return res.status(403).json({ error: 'Token inválido ou expirado' });
  }
};

module.exports = authenticate;