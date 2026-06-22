const { prisma } = require('../config/prisma');
const { sanitizeString, sanitizeSlug } = require('../utils/sanitize');
const { mapProductsForStore, visibleVariantWhere } = require('../utils/productStore');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Gera um slug único a partir do nome, garantindo que não colida com outro
 * registro (exceto o próprio em caso de update).
 */
async function generateUniqueSlug(name, ignoreId = null) {
  const base = sanitizeSlug(name) || 'categoria';
  let slug = base;
  let n = 1;
  // tenta no máximo 50 sufixos para evitar loop infinito
  while (n < 50) {
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (!existing || existing.id === ignoreId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Constrói árvore hierárquica a partir de lista flat.
 */
function buildTree(rows) {
  const byId = new Map();
  rows.forEach((c) => byId.set(c.id, { ...c, subcategories: [] }));

  const roots = [];
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId).subcategories.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortRecursive = (arr) => {
    arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    arr.forEach((n) => sortRecursive(n.subcategories));
  };
  sortRecursive(roots);
  return roots;
}

/**
 * Verifica se moveTarget criaria ciclo na hierarquia.
 */
async function wouldCreateCycle(categoryId, newParentId) {
  if (!newParentId) return false;
  if (categoryId === newParentId) return true;
  let current = newParentId;
  let depth = 0;
  while (current && depth < 50) {
    const parent = await prisma.category.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    if (!parent) return false;
    if (parent.parentId === categoryId) return true;
    current = parent.parentId;
    depth += 1;
  }
  return false;
}

// ─── Controller ──────────────────────────────────────────────────────────────

class CategoryController {
  /** GET /v2/api/categories — árvore pública (somente ativas) */
  async listPublic(req, res) {
    try {
      const rows = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          showInNavbar: true,
          isActive: true,
          parentId: true,
          sortOrder: true,
        },
      });
      return res.json({ categories: buildTree(rows) });
    } catch (err) {
      console.error('[Category.listPublic]', err);
      return res.status(500).json({ error: 'Erro ao listar categorias' });
    }
  }

  /** GET /v2/api/categories/:slug — página da categoria na loja */
  async getBySlugPublic(req, res) {
    try {
      const slug = sanitizeSlug(req.params.slug);
      if (!slug) return res.status(400).json({ error: 'Slug inválido' });

      const category = await prisma.category.findFirst({
        where: { slug, isActive: true },
      });
      if (!category) return res.status(404).json({ error: 'Categoria não encontrada' });

      const [subcategories, products, parent] = await Promise.all([
        prisma.category.findMany({
          where: { parentId: category.id, isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            slug: true,
            imageUrl: true,
            bannerUrl: true,
            _count: { select: { products: true } },
          },
        }),
        prisma.product.findMany({
          where: {
            categoryId: category.id,
            isActive: true,
            isVisible: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
          include: {
            variants: {
              where: visibleVariantWhere(),
              orderBy: { sortOrder: 'asc' },
            },
          },
        }),
        category.parentId
          ? prisma.category.findUnique({
              where: { id: category.parentId, isActive: true },
              select: { id: true, name: true, slug: true },
            })
          : Promise.resolve(null),
      ]);

      return res.json({
        category: {
          id: category.id,
          name: category.name,
          slug: category.slug,
          imageUrl: category.imageUrl,
          bannerUrl: category.bannerUrl,
          parent,
          subcategories: subcategories.map((s) => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            imageUrl: s.imageUrl,
            bannerUrl: s.bannerUrl,
            productCount: s._count.products,
          })),
          products: await mapProductsForStore(prisma, products),
        },
      });
    } catch (err) {
      console.error('[Category.getBySlugPublic]', err);
      return res.status(500).json({ error: 'Erro ao buscar categoria' });
    }
  }

  /** GET /v2/api/admin/categories - árvore completa */
  async list(req, res) {
    try {
      const flat = req.query.flat === 'true';
      const rows = await prisma.category.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { products: true, subcategories: true } },
        },
      });

      if (flat) {
        return res.json({ categories: rows });
      }
      return res.json({ categories: buildTree(rows) });
    } catch (err) {
      console.error('[Category.list]', err);
      return res.status(500).json({ error: 'Erro ao listar categorias' });
    }
  }

  /** GET /v2/api/admin/categories/:id */
  async getById(req, res) {
    try {
      const id = sanitizeString(req.params.id, 60);
      const category = await prisma.category.findUnique({
        where: { id },
        include: {
          parent: { select: { id: true, name: true, slug: true } },
          subcategories: { select: { id: true, name: true, slug: true } },
          _count: { select: { products: true } },
        },
      });
      if (!category) return res.status(404).json({ error: 'Categoria não encontrada' });
      return res.json(category);
    } catch (err) {
      console.error('[Category.getById]', err);
      return res.status(500).json({ error: 'Erro ao buscar categoria' });
    }
  }

  /** POST /v2/api/admin/categories */
  async create(req, res) {
    try {
      const name = sanitizeString(req.body?.name, 80);
      if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

      const parentId = req.body?.parentId ? sanitizeString(req.body.parentId, 60) : null;
      if (parentId) {
        const parent = await prisma.category.findUnique({ where: { id: parentId } });
        if (!parent) return res.status(400).json({ error: 'Categoria pai inválida' });
      }

      const slug = await generateUniqueSlug(name);
      const created = await prisma.category.create({
        data: {
          name,
          slug,
          imageUrl: req.body?.imageUrl ? sanitizeString(req.body.imageUrl, 500) : null,
          bannerUrl: req.body?.bannerUrl ? sanitizeString(req.body.bannerUrl, 500) : null,
          showInNavbar: Boolean(req.body?.showInNavbar),
          isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true,
          sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
          parentId: parentId || null,
        },
      });
      return res.status(201).json(created);
    } catch (err) {
      console.error('[Category.create]', err);
      return res.status(500).json({ error: 'Erro ao criar categoria' });
    }
  }

  /** PUT /v2/api/admin/categories/:id */
  async update(req, res) {
    try {
      const id = sanitizeString(req.params.id, 60);
      const existing = await prisma.category.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: 'Categoria não encontrada' });

      const data = {};
      if (req.body?.name !== undefined) {
        const name = sanitizeString(req.body.name, 80);
        if (!name) return res.status(400).json({ error: 'Nome inválido' });
        data.name = name;
        if (name !== existing.name) {
          data.slug = await generateUniqueSlug(name, id);
        }
      }
      if (req.body?.imageUrl !== undefined) {
        data.imageUrl = req.body.imageUrl
          ? sanitizeString(req.body.imageUrl, 500)
          : null;
      }
      if (req.body?.bannerUrl !== undefined) {
        data.bannerUrl = req.body.bannerUrl
          ? sanitizeString(req.body.bannerUrl, 500)
          : null;
      }
      if (req.body?.showInNavbar !== undefined) data.showInNavbar = Boolean(req.body.showInNavbar);
      if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
      if (req.body?.sortOrder !== undefined) {
        const n = Number(req.body.sortOrder);
        if (Number.isFinite(n)) data.sortOrder = n;
      }
      if (req.body?.parentId !== undefined) {
        const newParentId = req.body.parentId ? sanitizeString(req.body.parentId, 60) : null;
        if (newParentId) {
          if (newParentId === id) return res.status(400).json({ error: 'Categoria não pode ser pai de si mesma' });
          const parentExists = await prisma.category.findUnique({ where: { id: newParentId } });
          if (!parentExists) return res.status(400).json({ error: 'Categoria pai inválida' });
          const cycle = await wouldCreateCycle(id, newParentId);
          if (cycle) return res.status(400).json({ error: 'Hierarquia inválida (ciclo detectado)' });
        }
        data.parentId = newParentId;
      }

      const updated = await prisma.category.update({ where: { id }, data });
      return res.json(updated);
    } catch (err) {
      console.error('[Category.update]', err);
      return res.status(500).json({ error: 'Erro ao atualizar categoria' });
    }
  }

  /** PUT /v2/api/admin/categories/reorder */
  async reorder(req, res) {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Payload "items" inválido ou ausente' });
      }

      // Executa todas as atualizações em uma única transação
      await prisma.$transaction(
        items.map((item) =>
          prisma.category.update({
            where: { id: item.id },
            data: { sortOrder: item.sortOrder },
          })
        )
      );

      return res.json({ success: true });
    } catch (err) {
      console.error('[Category.reorder]', err);
      return res.status(500).json({ error: 'Erro ao reordenar categorias' });
    }
  }

  /** DELETE /v2/api/admin/categories/:id */
  async remove(req, res) {
    try {
      const id = sanitizeString(req.params.id, 60);
      const existing = await prisma.category.findUnique({
        where: { id },
        include: { _count: { select: { products: true, subcategories: true } } },
      });
      if (!existing) return res.status(404).json({ error: 'Categoria não encontrada' });

      if (existing._count.products > 0) {
        return res.status(409).json({
          error: 'Não é possível excluir uma categoria que possui produtos associados',
        });
      }
      if (existing._count.subcategories > 0) {
        return res.status(409).json({
          error: 'Não é possível excluir uma categoria que possui subcategorias',
        });
      }

      await prisma.category.delete({ where: { id } });
      return res.json({ success: true });
    } catch (err) {
      console.error('[Category.remove]', err);
      return res.status(500).json({ error: 'Erro ao excluir categoria' });
    }
  }
}

module.exports = new CategoryController();
