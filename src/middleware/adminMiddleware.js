const { prisma } = require('../config/prisma');

/**
 * Middleware de verificação de admin.
 * Deve ser usado APÓS o authenticate middleware.
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

    next();
  } catch (err) {
    console.error('[requireAdmin]', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
};

module.exports = requireAdmin;
