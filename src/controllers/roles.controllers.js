const { prisma } = require('../config/prisma');
const { ALL_PERMISSIONS } = require('../config/permissions');
const { isSuperOwner } = require('../utils/auth');
const {
  recordAdminAction,
  AUDIT_ACTIONS,
  requestContext,
} = require('../services/auditLog.service');

const hasSuperOwnerPermission = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return isSuperOwner(user?.email);
};

// ─── Role Controller ────────────────────────────────────────────────────────

class RoleController {
  // ─── Permissions ─────────────────────────────────────────────────────────

  async getAllPermissions(req, res) {
    try {
      // Group permissions by category
      const grouped = ALL_PERMISSIONS.reduce((acc, perm) => {
        if (!acc[perm.category]) {
          acc[perm.category] = [];
        }
        acc[perm.category].push(perm);
        return acc;
      }, {});

      return res.json({
        permissions: ALL_PERMISSIONS,
        grouped,
      });
    } catch (err) {
      console.error('[getAllPermissions Error]', err);
      return res.status(500).json({ error: 'Erro ao buscar permissões' });
    }
  }

  // ─── Roles CRUD ────────────────────────────────────────────────────────────

  async getAllRoles(req, res) {
    try {
      const roles = await prisma.role.findMany({
        include: {
          _count: {
            select: { users: true },
          },
          permissions: {
            select: { key: true, name: true },
          },
        },
        orderBy: { sortOrder: 'asc' },
      });

      // Format response
      const formatted = roles.map((role) => ({
        ...role,
        userCount: role._count.users,
        _count: undefined,
      }));

      return res.json({ roles: formatted });
    } catch (err) {
      console.error('[getAllRoles Error]', err);
      return res.status(500).json({ error: 'Erro ao buscar cargos' });
    }
  }

  async getRoleById(req, res) {
    try {
      const { id } = req.params;

      const role = await prisma.role.findUnique({
        where: { id },
        include: {
          permissions: true,
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      if (!role) {
        return res.status(404).json({ error: 'Cargo não encontrado' });
      }

      return res.json({ role });
    } catch (err) {
      console.error('[getRoleById Error]', err);
      return res.status(500).json({ error: 'Erro ao buscar cargo' });
    }
  }

  async createRole(req, res) {
    try {
      const { name, description, permissionKeys } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Nome do cargo é obrigatório' });
      }

      // Validate permissions
      const validPermissions = ALL_PERMISSIONS.filter((p) =>
        permissionKeys?.includes(p.key)
      );

      // Create role with permissions
      const role = await prisma.role.create({
        data: {
          name,
          description,
          permissions: {
            connect: validPermissions.map((p) => ({ key: p.key })),
          },
        },
        include: {
          permissions: true,
          _count: {
            select: { users: true },
          },
        },
      });

      await recordAdminAction({
        ...requestContext(req),
        action: AUDIT_ACTIONS.ROLE_CREATE,
        targetType: 'role',
        targetId: role.id,
        metadata: {
          roleName: role.name,
          permissions: role.permissions.map((p) => p.key),
        },
      });

      return res.status(201).json({
        success: true,
        role: {
          ...role,
          userCount: 0,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(400).json({ error: 'Já existe um cargo com este nome' });
      }
      console.error('[createRole Error]', err);
      return res.status(500).json({ error: 'Erro ao criar cargo' });
    }
  }

  async updateRole(req, res) {
    try {
      const { id } = req.params;
      const { name, description, permissionKeys } = req.body;

      // Check if role exists and is not protected
      const existingRole = await prisma.role.findUnique({
        where: { id },
        include: { permissions: { select: { key: true } } },
      });

      if (!existingRole) {
        return res.status(404).json({ error: 'Cargo não encontrado' });
      }

      if (existingRole.isProtected) {
        return res.status(403).json({
          error: 'Este cargo é protegido e não pode ser alterado',
        });
      }

      // Validate permissions
      const validPermissions = ALL_PERMISSIONS.filter((p) =>
        permissionKeys?.includes(p.key)
      );

      // Update role
      const role = await prisma.role.update({
        where: { id },
        data: {
          name,
          description,
          permissions: {
            set: validPermissions.map((p) => ({ key: p.key })),
          },
        },
        include: {
          permissions: true,
          _count: {
            select: { users: true },
          },
        },
      });

      await recordAdminAction({
        ...requestContext(req),
        action: AUDIT_ACTIONS.ROLE_UPDATE,
        targetType: 'role',
        targetId: id,
        metadata: {
          roleName: role.name,
          oldName: existingRole.name,
          newName: role.name,
          oldPermissions: existingRole.permissions.map((p) => p.key),
          newPermissions: role.permissions.map((p) => p.key),
        },
      });

      return res.json({
        success: true,
        role: {
          ...role,
          userCount: role._count.users,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(400).json({ error: 'Já existe um cargo com este nome' });
      }
      console.error('[updateRole Error]', err);
      return res.status(500).json({ error: 'Erro ao atualizar cargo' });
    }
  }

  async deleteRole(req, res) {
    try {
      const { id } = req.params;

      // Check if role exists and is not protected
      const existingRole = await prisma.role.findUnique({
        where: { id },
        include: {
          _count: {
            select: { users: true },
          },
        },
      });

      if (!existingRole) {
        return res.status(404).json({ error: 'Cargo não encontrado' });
      }

      if (existingRole.isProtected) {
        return res.status(403).json({
          error: 'Este cargo é protegido e não pode ser excluído',
        });
      }

      if (existingRole._count.users > 0) {
        return res.status(400).json({
          error: 'Não é possível excluir um cargo que possui usuários',
        });
      }

      await prisma.role.delete({
        where: { id },
      });

      await recordAdminAction({
        ...requestContext(req),
        action: AUDIT_ACTIONS.ROLE_DELETE,
        targetType: 'role',
        targetId: id,
        metadata: { roleName: existingRole.name },
      });

      return res.json({ success: true });
    } catch (err) {
      console.error('[deleteRole Error]', err);
      return res.status(500).json({ error: 'Erro ao excluir cargo' });
    }
  }

  // ─── User Role Management ─────────────────────────────────────────────────

  async assignRoleToUser(req, res) {
    try {
      const { userId } = req.params;
      const { roleId } = req.body;

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      // Check if target user is Super Owner
      if (isSuperOwner(user.email)) {
        return res.status(403).json({
          error: 'Este usuário é o Dono Supremo e não pode ter seu cargo alterado',
        });
      }

      // Check if role exists (if roleId provided)
      if (roleId) {
        const role = await prisma.role.findUnique({
          where: { id: roleId },
        });

        if (!role) {
          return res.status(404).json({ error: 'Cargo não encontrado' });
        }

        if (role.isProtected) {
          return res.status(403).json({
            error: 'Este cargo é protegido e não pode ser atribuído manualmente',
          });
        }
      }

      // Update user role and set isAdmin flag accordingly
      // Note: We protect the Super Owner so they remain admin even if no role is assigned
      const userToUpdate = await prisma.user.findUnique({ where: { id: userId } });
      if (!userToUpdate) return res.status(404).json({ error: 'Usuário não encontrado' });

      const isUserSuperOwner = isSuperOwner(userToUpdate.email);

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          roleId: roleId || null,
          isAdmin: isUserSuperOwner ? true : !!roleId
        },
        include: {
          role: {
            include: {
              permissions: true,
            },
          },
        },
      });

      await recordAdminAction({
        ...requestContext(req),
        action: AUDIT_ACTIONS.TEAM_ROLE_ASSIGN,
        targetType: 'user',
        targetId: userId,
        metadata: {
          userName: user.name || user.email,
          userEmail: user.email,
          oldRoleId: user.roleId || null,
          oldRoleName: user.role?.name || null,
          newRoleId: updatedUser.roleId || null,
          newRoleName: updatedUser.role?.name || null,
        },
      });

      return res.json({
        success: true,
        user: updatedUser,
      });
    } catch (err) {
      console.error('[assignRoleToUser Error]', err);
      return res.status(500).json({ error: 'Erro ao atribuir cargo' });
    }
  }

  // ─── Check User Permissions ────────────────────────────────────────────────

  async getUserPermissions(req, res) {
    try {
      const { userId } = req.params;

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

      // Super Owner has all permissions
      if (isSuperOwner(user.email)) {
        return res.json({
          isSuperOwner: true,
          permissions: ALL_PERMISSIONS.map((p) => p.key),
          role: user.role,
        });
      }

      const permissions = user.role?.permissions.map((p) => p.key) || [];

      return res.json({
        isSuperOwner: false,
        permissions,
        role: user.role,
      });
    } catch (err) {
      console.error('[getUserPermissions Error]', err);
      return res.status(500).json({ error: 'Erro ao buscar permissões' });
    }
  }

  async checkPermission(req, res) {
    try {
      const { permission } = req.params;
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

      // Super Owner has all permissions
      if (isSuperOwner(user.email)) {
        return res.json({ hasPermission: true, isSuperOwner: true });
      }

      const hasPermission = user.role?.permissions.some(
        (p) => p.key === permission
      );

      return res.json({ hasPermission, isSuperOwner: false });
    } catch (err) {
      console.error('[checkPermission Error]', err);
      return res.status(500).json({ error: 'Erro ao verificar permissão' });
    }
  }

  async reorderRoles(req, res) {
    try {
      const { roles } = req.body;

      if (!Array.isArray(roles)) {
        return res.status(400).json({ error: 'Lista de cargos inválida' });
      }

      await Promise.all(
        roles.map((role) =>
          prisma.role.update({
            where: { id: role.id },
            data: { sortOrder: role.sortOrder },
          })
        )
      );

      return res.json({ success: true });
    } catch (err) {
      console.error('[reorderRoles Error]', err);
      return res.status(500).json({ error: 'Erro ao reordenar cargos' });
    }
  }
}

module.exports = new RoleController();
