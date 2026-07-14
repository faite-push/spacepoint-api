const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');

const DEFAULT_REVIEWS = [
  
];

async function ensureDefaultReviews() {
  const count = await prisma.homeReview.count();
  if (count > 0) return;
  await prisma.homeReview.createMany({
    data: DEFAULT_REVIEWS.map((r) => ({ ...r, isPublished: true })),
  });
}

const DEFAULT_PAGE_SEO = [
  {
    pageKey: 'home',
    metaTitle: 'Space Point BR | Jogos digitais para PlayStation',
    metaDescription: 'Compre jogos digitais originais para PS4 e PS5 com entrega instantânea e garantia.',
  },
  {
    pageKey: 'products',
    metaTitle: 'Produtos | Space Point',
    metaDescription: 'Catálogo completo de jogos digitais com os melhores preços.',
  },
  {
    pageKey: 'checkout',
    metaTitle: 'Checkout | Space Point',
    metaDescription: 'Finalize sua compra com segurança.',
  },
  {
    pageKey: 'login',
    metaTitle: 'Entrar | Space Point',
    metaDescription: 'Acesse sua conta Space Point.',
  },
  {
    pageKey: 'account',
    metaTitle: 'Minha conta | Space Point',
    metaDescription: 'Gerencie seus pedidos e dados da conta.',
  },
  {
    pageKey: 'category',
    metaTitle: '{name} | Space Point',
    metaDescription: 'Compre jogos digitais na categoria {name}.',
  },
  {
    pageKey: 'product',
    metaTitle: '{name} | Space Point',
    metaDescription: 'Compre {name} com entrega digital instantânea na Space Point.',
  },
];

async function ensureDefaultPageSeo() {
  for (const row of DEFAULT_PAGE_SEO) {
    await prisma.pageSeo.upsert({
      where: { pageKey: row.pageKey },
      update: {},
      create: row,
    });
  }
}

class HomeReviewController {
  async listPublic(req, res) {
    try {
      await ensureDefaultReviews();
      const reviews = await prisma.homeReview.findMany({
        where: { isPublished: true },
        orderBy: { sortOrder: 'asc' },
      });
      return res.json({ reviews });
    } catch (err) {
      console.error('[HomeReview.listPublic]', err);
      return res.status(500).json({ error: 'Erro ao carregar avaliações' });
    }
  }

  async listAdmin(req, res) {
    try {
      const reviews = await prisma.homeReview.findMany({
        orderBy: { sortOrder: 'asc' },
      });
      return res.json({ reviews });
    } catch (err) {
      console.error('[HomeReview.listAdmin]', err);
      return res.status(500).json({ error: 'Erro ao listar avaliações' });
    }
  }

  async create(req, res) {
    try {
      const name = sanitizeString(req.body?.name, 80);
      const comment = sanitizeString(req.body?.comment, 2000);
      if (!name || !comment) {
        return res.status(400).json({ error: 'Nome e comentário são obrigatórios' });
      }
      const total = await prisma.homeReview.count();
      const review = await prisma.homeReview.create({
        data: {
          name,
          comment,
          avatarUrl: req.body?.avatarUrl ? sanitizeString(req.body.avatarUrl, 500) : null,
          rating: Math.min(5, Math.max(1, parseInt(req.body?.rating, 10) || 5)),
          dateLabel: req.body?.dateLabel ? sanitizeString(req.body.dateLabel, 40) : null,
          isPublished: req.body?.isPublished !== false,
          sortOrder: total,
        },
      });
      return res.status(201).json(review);
    } catch (err) {
      console.error('[HomeReview.create]', err);
      return res.status(500).json({ error: 'Erro ao criar avaliação' });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const data = {};
      if (req.body?.name !== undefined) data.name = sanitizeString(req.body.name, 80);
      if (req.body?.comment !== undefined) data.comment = sanitizeString(req.body.comment, 2000);
      if (req.body?.avatarUrl !== undefined) {
        data.avatarUrl = req.body.avatarUrl ? sanitizeString(req.body.avatarUrl, 500) : null;
      }
      if (req.body?.rating !== undefined) {
        data.rating = Math.min(5, Math.max(1, parseInt(req.body.rating, 10) || 5));
      }
      if (req.body?.dateLabel !== undefined) {
        data.dateLabel = req.body.dateLabel ? sanitizeString(req.body.dateLabel, 40) : null;
      }
      if (req.body?.isPublished !== undefined) data.isPublished = Boolean(req.body.isPublished);
      if (req.body?.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder) || 0;

      const review = await prisma.homeReview.update({ where: { id }, data });
      return res.json(review);
    } catch (err) {
      if (err?.code === 'P2025') return res.status(404).json({ error: 'Avaliação não encontrada' });
      console.error('[HomeReview.update]', err);
      return res.status(500).json({ error: 'Erro ao atualizar avaliação' });
    }
  }

  async remove(req, res) {
    try {
      const id = sanitizeString(req.params.id, 40);
      if (!id) {
        return res.status(400).json({ error: 'ID inválido' });
      }

      const { count } = await prisma.homeReview.deleteMany({ where: { id } });
      if (count === 0) {
        return res.status(404).json({ error: 'Avaliação não encontrada' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('[HomeReview.remove]', err);
      return res.status(500).json({ error: 'Erro ao excluir avaliação' });
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
          prisma.homeReview.updateMany({
            where: { id },
            data: { sortOrder: index },
          })
        )
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('[HomeReview.reorder]', err);
      return res.status(500).json({ error: 'Erro ao reordenar avaliações' });
    }
  }

  async listPageSeo(req, res) {
    try {
      await ensureDefaultPageSeo();
      const pages = await prisma.pageSeo.findMany({ orderBy: { pageKey: 'asc' } });
      return res.json({ pages });
    } catch (err) {
      console.error('[HomeReview.listPageSeo]', err);
      return res.status(500).json({ error: 'Erro ao listar SEO' });
    }
  }

  async getPageSeoPublic(req, res) {
    try {
      await ensureDefaultPageSeo();
      const page = await prisma.pageSeo.findUnique({
        where: { pageKey: req.params.pageKey },
      });
      if (!page) return res.status(404).json({ error: 'SEO não encontrado' });
      return res.json(page);
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao carregar SEO' });
    }
  }

  async updatePageSeo(req, res) {
    try {
      const pageKey = sanitizeString(req.params.pageKey, 40);
      if (!pageKey) return res.status(400).json({ error: 'Chave inválida' });

      const data = {};
      if (req.body?.metaTitle !== undefined) {
        data.metaTitle = req.body.metaTitle ? sanitizeString(req.body.metaTitle, 120) : null;
      }
      if (req.body?.metaDescription !== undefined) {
        data.metaDescription = req.body.metaDescription
          ? sanitizeString(req.body.metaDescription, 500)
          : null;
      }
      if (req.body?.ogImageUrl !== undefined) {
        data.ogImageUrl = req.body.ogImageUrl ? sanitizeString(req.body.ogImageUrl, 500) : null;
      }

      const page = await prisma.pageSeo.upsert({
        where: { pageKey },
        update: data,
        create: { pageKey, ...data },
      });
      return res.json(page);
    } catch (err) {
      console.error('[HomeReview.updatePageSeo]', err);
      return res.status(500).json({ error: 'Erro ao salvar SEO' });
    }
  }
}

module.exports = new HomeReviewController();
module.exports.ensureDefaultPageSeo = ensureDefaultPageSeo;
module.exports.ensureDefaultReviews = ensureDefaultReviews;
