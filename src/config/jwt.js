const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.ACCESS_TOKEN_SECRET;

const generateToken = (payload, options = {}) => {
  const { expiresIn = '7d' } = options;
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    throw new Error('Token inválido ou expirado');
  }
};

module.exports = { generateToken, verifyToken };