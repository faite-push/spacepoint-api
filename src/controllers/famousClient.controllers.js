const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');
const { resolveEntityMedia } = require('../utils/mediaUrl');

class FamousClientController {
  async listPublic(req, res) {
    try {
      const clients = await prisma.famousClient.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      return res.json({
        clients: clients.map((c) => resolveEntityMedia(c, req)),
      });
    } catch (err) {
      console.error('[FamousClient.listPublic]', err);
      return res.status(500).json({ error: 'Erro ao carregar clientes famosos' });
    }
  }

  async listAdmin(req, res) {
    try {
      const clients = await prisma.famousClient.findMany({
        orderBy: { sortOrder: 'asc' },
      });
      return res.json({
        clients: clients.map((c) => resolveEntityMedia(c, req)),
      });
    } catch (err) {
      console.error('[FamousClient.listAdmin]', err);
      return res.status(500).json({ error: 'Erro ao listar clientes famosos' });
    }
  }

  async create(req, res) {
    try {
      const name = sanitizeString(req.body?.name, 80);
      if (!name) {
        return res.status(400).json({ error: 'Nome é obrigatório' });
      }
      const total = await prisma.famousClient.count();
      const client = await prisma.famousClient.create({
        data: {
          name,
          subtitle: req.body?.subtitle ? sanitizeString(req.body.subtitle, 80) : null,
          avatarUrl: req.body?.avatarUrl ? sanitizeString(req.body.avatarUrl, 500) : null,
          videoUrl: req.body?.videoUrl ? sanitizeString(req.body.videoUrl, 500) : null,
          isActive: req.body?.isActive !== false,
          sortOrder: total,
        },
      });
      return res.status(201).json(resolveEntityMedia(client, req));
    } catch (err) {
      console.error('[FamousClient.create]', err);
      return res.status(500).json({ error: 'Erro ao criar cliente famoso' });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const data = {};
      if (req.body?.name !== undefined) data.name = sanitizeString(req.body.name, 80);
      if (req.body?.subtitle !== undefined) {
        data.subtitle = req.body.subtitle ? sanitizeString(req.body.subtitle, 80) : null;
      }
      if (req.body?.avatarUrl !== undefined) {
        data.avatarUrl = req.body.avatarUrl ? sanitizeString(req.body.avatarUrl, 500) : null;
      }
      if (req.body?.videoUrl !== undefined) {
        data.videoUrl = req.body.videoUrl ? sanitizeString(req.body.videoUrl, 500) : null;
      }
      if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
      if (req.body?.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder) || 0;

      const client = await prisma.famousClient.update({ where: { id }, data });
      return res.json(resolveEntityMedia(client, req));
    } catch (err) {
      if (err?.code === 'P2025') return res.status(404).json({ error: 'Cliente não encontrado' });
      console.error('[FamousClient.update]', err);
      return res.status(500).json({ error: 'Erro ao atualizar cliente famoso' });
    }
  }

  async remove(req, res) {
    try {
      const id = sanitizeString(req.params.id, 40);
      if (!id) {
        return res.status(400).json({ error: 'ID inválido' });
      }

      const { count } = await prisma.famousClient.deleteMany({ where: { id } });
      if (count === 0) {
        return res.status(404).json({ error: 'Cliente não encontrado' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('[FamousClient.remove]', err);
      return res.status(500).json({ error: 'Erro ao excluir cliente famoso' });
    }
  }

  async reorder(req, res) {
    try {
      const items = req.body?.items;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Lista de itens inválida' });
      }
      const ids = items
        .map((item) => sanitizeString(item?.id, 40))
        .filter(Boolean);

      if (ids.length === 0) {
        return res.status(400).json({ error: 'Lista de itens inválida' });
      }

      await prisma.$transaction(
        ids.map((id, index) =>
          prisma.famousClient.updateMany({
            where: { id },
            data: { sortOrder: index },
          })
        )
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('[FamousClient.reorder]', err);
      return res.status(500).json({ error: 'Erro ao reordenar clientes famosos' });
    }
  }
}

module.exports = new FamousClientController();
