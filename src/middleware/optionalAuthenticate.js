const { verifyToken } = require('../config/jwt');

const optionalAuthenticate = (req, res, next) => {
  const token = req.cookies?.access_token;
  if (!token) return next();

  try {
    req.user = verifyToken(token);
  } catch {
    req.user = undefined;
  }

  next();
};

module.exports = optionalAuthenticate;
