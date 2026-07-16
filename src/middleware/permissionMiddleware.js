const { prisma } = require('../config/prisma');
const { isSuperOwner } = require('../utils/auth');
const { FULL_ACCESS_PERMISSION } = require('../config/permissions');

async function loadUserPermissions(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: {
          permissions: true,
        },
      },
    },
  });
}

function permissionKeysFromUser(user) {
  return user?.role?.permissions?.map((p) => p.key) || [];
}

function userKeysAllow(permissionKeys, permissionKey) {
  if (permissionKeys.includes(FULL_ACCESS_PERMISSION)) return true;
  return permissionKeys.includes(permissionKey);
}

async function userHasPermission(userId, permissionKey) {
  const user = await loadUserPermissions(userId);
  if (!user) return false;
  if (isSuperOwner(user.email)) return true;
  if (!user.role) return false;
  return userKeysAllow(permissionKeysFromUser(user), permissionKey);
}

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

      const keys = permissionKeysFromUser(user);
      if (!userKeysAllow(keys, permissionKey)) {
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

      const keys = permissionKeysFromUser(user);
      if (keys.includes(FULL_ACCESS_PERMISSION)) {
        return next();
      }

      const allowed = permissionKeys.some((key) => keys.includes(key));

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
module.exports.userHasPermission = userHasPermission;
module.exports.FULL_ACCESS_PERMISSION = FULL_ACCESS_PERMISSION;
