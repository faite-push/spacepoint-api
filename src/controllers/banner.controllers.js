const { prisma } = require('../config/prisma');

class BannerController {
  async list(req, res) {
    try {
      const banners = await prisma.banner.findMany({
        orderBy: { sortOrder: 'asc' },
      });
      return res.json({ banners });
    } catch (err) {
      console.error('[ERRO] Ao listar banners:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async create(req, res) {
    try {
      const { imageUrl, linkUrl, isActive } = req.body;
      if (!imageUrl) {
        return res.status(400).json({ error: 'A URL da imagem é obrigatória' });
      }

      const total = await prisma.banner.count();
      const newBanner = await prisma.banner.create({
        data: {
          imageUrl,
          linkUrl: linkUrl || null,
          isActive: isActive !== undefined ? isActive : true,
          sortOrder: total,
        },
      });

      return res.status(201).json(newBanner);
    } catch (err) {
      console.error('[ERRO] Ao criar banner:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { imageUrl, linkUrl, isActive } = req.body;

      if (!id) return res.status(400).json({ error: 'ID ausente' });

      const updated = await prisma.banner.update({
        where: { id },
        data: {
          imageUrl,
          linkUrl: linkUrl || null,
          isActive,
        },
      });

      return res.json(updated);
    } catch (err) {
      console.error('[ERRO] Ao atualizar banner:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: 'ID ausente' });

      await prisma.banner.delete({ where: { id } });

      return res.json({ message: 'Banner deletado com sucesso' });
    } catch (err) {
      console.error('[ERRO] Ao deletar banner:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async reorder(req, res) {
    try {
      const { orderedIds } = req.body;

      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: 'Formato inválido. `orderedIds` precisa ser um array.' });
      }

      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.banner.update({
            where: { id },
            data: { sortOrder: index },
          })
        )
      );

      return res.json({ message: 'Ordem atualizada com sucesso' });
    } catch (error) {
      console.error('[BANNERS] Reorder error:', error);
      return res.status(500).json({ error: 'Erro interno do servidor ao reordenar banners.' });
    }
  }
}

module.exports = new BannerController();
