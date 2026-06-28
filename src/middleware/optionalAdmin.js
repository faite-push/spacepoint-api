const { prisma } = require('../config/prisma');

/**
 * Middleware que verifica se o usuário é admin mas NÃO bloqueia se não for.
 * Seta req.user.isAdmin = true se for admin.
 * Deve ser usado APÓS o authenticate middleware.
 */
const optionalAdmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isAdmin: true },
    });

    if (user?.isAdmin) {
      req.user.isAdmin = true;
    } else {
      req.user.isAdmin = false;
    }

    next();
  } catch (err) {
    console.error('[optionalAdmin]', err.message);
    next(); // Prossiga mesmo com erro, o controlador tratará a falta de permissão se necessário
  }
};

module.exports = optionalAdmin;
