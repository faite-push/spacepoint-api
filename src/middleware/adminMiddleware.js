const { prisma } = require('../config/prisma');

/**
 * Middleware de verificação de admin.
 * Deve ser usado APÓS o authenticate middleware.
 * Também seta req.user.isAdmin = true para que controllers possam usá-lo.
 */
const requireAdmin = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isAdmin: true },
    });

    if (!user?.isAdmin) {
      return res.status(403).json({ error: 'Acesso negado: somente administradores' });
    }

    // Garante que req.user.isAdmin esteja correto independente do payload do JWT
    req.user.isAdmin = true;

    next();
  } catch (err) {
    console.error('[requireAdmin]', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
};

module.exports = requireAdmin;
