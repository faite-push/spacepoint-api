const { prisma } = require('../config/prisma');
const { isSuperOwner } = require('../utils/auth');

class UserController {
  /**
   * Lista todos os usuários (admin only).
   */
  async getAllUsers(req, res) {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          provider: true,
          isAdmin: true,
          createdAt: true,
          roleId: true,
          role: {
            select: {
              id: true,
              name: true,
              isProtected: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      const formatted = users.map((user) => ({
        ...user,
        isSuperOwner: isSuperOwner(user.email),
      }));
      return res.json({ success: true, count: formatted.length, users: formatted });
    } catch (err) {
      console.error('[getAllUsers]', err.message);
      return res.status(500).json({ error: 'Erro interno ao buscar usuários' });
    }
  }

  /**
   * Detalhes de um usuário por ID (admin only).
   */
  async getUserById(req, res) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: {
          id: true, name: true, email: true,
          image: true, provider: true,
          isAdmin: true, createdAt: true,
        },
      });
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
      return res.json({ success: true, user });
    } catch (err) {
      console.error('[getUserById]', err.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  /**
   * Alterna status admin do usuário.
   */
  async toggleAdmin(req, res) {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { isAdmin: true } });
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

      const updated = await prisma.user.update({
        where: { id: req.params.id },
        data: { isAdmin: !user.isAdmin },
        select: { id: true, name: true, isAdmin: true },
      });
      return res.json({ success: true, user: updated });
    } catch (err) {
      console.error('[toggleAdmin]', err.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  /**
   * Lista apenas membros da equipe (admin ou com role).
   */
  async getTeam(req, res) {
    try {
      const users = await prisma.user.findMany({
        where: {
          OR: [
            { isAdmin: true },
            { roleId: { not: null } }
          ]
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          isAdmin: true,
          createdAt: true,
          role: {
            select: {
              id: true,
              name: true,
              isProtected: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ success: true, count: users.length, users });
    } catch (err) {
      console.error('[getTeam]', err.message);
      return res.status(500).json({ error: 'Erro ao buscar membros da equipe' });
    }
  }

  /**
   * Busca usuários por nome ou email para adicionar à equipe.
   */
  async searchUsers(req, res) {
    try {
      const { query } = req.query;
      if (!query) return res.status(400).json({ error: 'Termo de busca é obrigatório' });

      const users = await prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } }
          ]
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          roleId: true,
          isAdmin: true
        },
        take: 10
      });

      return res.json({ success: true, users });
    } catch (err) {
      console.error('[searchUsers]', err.message);
      return res.status(500).json({ error: 'Erro ao buscar usuários' });
    }
  }
}

module.exports = new UserController();