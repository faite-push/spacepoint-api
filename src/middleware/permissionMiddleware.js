const { prisma } = require('../config/prisma');
const { isSuperOwner } = require('../utils/auth');

/**
 * Middleware para verificar se o usuário autenticado tem uma permissão específica.
 * @param {string} permissionKey - A chave da permissão (ex: 'products:create')
 */
const requirePermission = (permissionKey) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Não autenticado' });
      }

      // Busca usuário com seu cargo e permissões
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          role: {
            include: {
              permissions: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      // 1. Dono Supremo sempre tem permissão
      if (isSuperOwner(user.email)) {
        return next();
      }

      // 2. Se não tem cargo, não tem permissão
      if (!user.role) {
        return res.status(403).json({ error: 'Acesso negado: você não possui um cargo atribuído' });
      }

      // 3. Verifica se a permissão existe no cargo do usuário
      const hasPermission = user.role.permissions.some(p => p.key === permissionKey);

      if (!hasPermission) {
        return res.status(403).json({ error: `Acesso negado: falta a permissão '${permissionKey}'` });
      }

      next();
    } catch (err) {
      console.error(`[requirePermission: ${permissionKey}]`, err.message);
      return res.status(500).json({ error: 'Erro ao verificar permissão' });
    }
  };
};

/**
 * Permite acesso se o usuário tiver pelo menos uma das permissões informadas.
 */
const requireAnyPermission = (...permissionKeys) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Não autenticado' });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          role: {
            include: {
              permissions: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      if (isSuperOwner(user.email)) {
        return next();
      }

      if (!user.role) {
        return res.status(403).json({ error: 'Acesso negado: você não possui um cargo atribuído' });
      }

      const userKeys = new Set(user.role.permissions.map((p) => p.key));
      const allowed = permissionKeys.some((key) => userKeys.has(key));

      if (!allowed) {
        return res.status(403).json({
          error: `Acesso negado: falta uma das permissões (${permissionKeys.join(', ')})`,
        });
      }

      next();
    } catch (err) {
      console.error(`[requireAnyPermission: ${permissionKeys.join('|')}]`, err.message);
      return res.status(500).json({ error: 'Erro ao verificar permissão' });
    }
  };
};

module.exports = requirePermission;
module.exports.any = requireAnyPermission;
