const { prisma } = require('../config/prisma');

class CouponController {
  async list(req, res) {
    try {
      const { search } = req.query;

      const coupons = await prisma.coupon.findMany({
        where: search ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ]
        } : {},
        include: {
          references: true,
          _count: {
            select: { usages: true }
          }
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({ coupons });
    } catch (err) {
      console.error('[COUPONS] List error:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async stats(req, res) {
    try {
      const { period = 'all' } = req.query;
      
      let dateFilter = {};
      const now = new Date();
      if (period === 'today') {
        dateFilter = { createdAt: { gte: new Date(now.setHours(0,0,0,0)) } };
      } else if (period === '7days') {
        dateFilter = { createdAt: { gte: new Date(now.setDate(now.getDate() - 7)) } };
      } else if (period === '30days') {
        dateFilter = { createdAt: { gte: new Date(now.setDate(now.getDate() - 30)) } };
      }

      const totalUses = await prisma.couponUsage.count({ where: dateFilter });
      const aggregated = await prisma.couponUsage.aggregate({
        where: dateFilter,
        _sum: {
          discount: true,
        }
      });

      // Valor convertido (total do pedido onde usou cupom)
      const usages = await prisma.couponUsage.findMany({
        where: dateFilter,
        include: { order: true }
      });
      const totalConverted = usages.reduce((acc, curr) => acc + (curr.order?.total || 0), 0);

      const uniqueCouponsUsed = [...new Set(usages.map(u => u.couponId))].length;

      return res.json({
        totalUses,
        uniqueCouponsUsed,
        totalDiscounted: aggregated._sum.discount || 0,
        totalConverted
      });
    } catch (err) {
      console.error('[COUPONS] Stats error:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async get(req, res) {
    try {
      const { id } = req.params;
      const coupon = await prisma.coupon.findUnique({
        where: { id },
        include: {
          references: true,
          usages: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { name: true, email: true } }, order: true }
          }
        }
      });

      if (!coupon) return res.status(404).json({ error: 'Cupom não encontrado' });
      return res.json(coupon);
    } catch (err) {
      console.error('[COUPONS] Get error:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async create(req, res) {
    try {
      const {
        code, description, type, value, minOrderValue, maxOrderValue,
        maxDiscount, maxUses, perUserLimit, isActive, startDate, endDate,
        allowedPayments, references
      } = req.body;

      if (!code || !type || value === undefined) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
      }

      const existing = await prisma.coupon.findUnique({ where: { code } });
      if (existing) return res.status(400).json({ error: 'Já existe um cupom com este código' });

      const coupon = await prisma.coupon.create({
        data: {
          code: code.toUpperCase(),
          description,
          type,
          value,
          minOrderValue,
          maxOrderValue,
          maxDiscount,
          maxUses: maxUses || null,
          perUserLimit: perUserLimit || 1,
          isActive: isActive !== undefined ? isActive : true,
          startDate: startDate ? new Date(startDate) : new Date(),
          endDate: endDate ? new Date(endDate) : null,
          allowedPayments: allowedPayments || [],
          references: references ? {
            create: references.map(ref => ({
              type: ref.type,
              referenceId: ref.referenceId
            }))
          } : undefined
        }
      });

      return res.status(201).json(coupon);
    } catch (err) {
      console.error('[COUPONS] Create error:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const {
        code, description, type, value, minOrderValue, maxOrderValue,
        maxDiscount, maxUses, perUserLimit, isActive, startDate, endDate,
        allowedPayments, references
      } = req.body;

      if (!id) return res.status(400).json({ error: 'ID ausente' });

      // Se mudar o código, verifica se já existe outro
      if (code) {
        const existing = await prisma.coupon.findFirst({
          where: { code: code.toUpperCase(), NOT: { id } }
        });
        if (existing) return res.status(400).json({ error: 'Código já em uso por outro cupom' });
      }

      const updateData = {
        code: code ? code.toUpperCase() : undefined,
        description,
        type,
        value,
        minOrderValue,
        maxOrderValue,
        maxDiscount,
        maxUses: maxUses === "" ? null : maxUses,
        perUserLimit,
        isActive,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate === "" ? null : (endDate ? new Date(endDate) : undefined),
        allowedPayments
      };

      // Limpa chaves undefined
      Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

      const result = await prisma.$transaction(async (tx) => {
        if (references) {
          await tx.couponReference.deleteMany({ where: { couponId: id } });
          updateData.references = {
            create: references.map(ref => ({
              type: ref.type,
              referenceId: ref.referenceId
            }))
          };
        }

        return await tx.coupon.update({
          where: { id },
          data: updateData,
          include: { references: true }
        });
      });

      return res.json(result);
    } catch (err) {
      console.error('[COUPONS] Update error:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: 'ID ausente' });

      await prisma.coupon.delete({ where: { id } });
      return res.json({ message: 'Cupom excluído com sucesso' });
    } catch (err) {
      console.error('[COUPONS] Delete error:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async duplicate(req, res) {
    try {
      const { id } = req.params;
      const original = await prisma.coupon.findUnique({
        where: { id },
        include: { references: true }
      });

      if (!original) return res.status(404).json({ error: 'Cupom original não encontrado' });

      const newCode = `${original.code}-COPY-${Math.floor(Math.random() * 1000)}`;
      
      const { id: _, createdAt: __, updatedAt: ___, usedCount: ____, usages: _____, ...data } = original;
      
      const copy = await prisma.coupon.create({
        data: {
          ...data,
          code: newCode,
          isActive: false,
          references: {
            create: original.references.map(ref => ({
              type: ref.type,
              referenceId: ref.referenceId
            }))
          }
        }
      });

      return res.status(201).json(copy);
    } catch (err) {
      console.error('[COUPONS] Duplicate error:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async validate(req, res) {
    try {
      const { code } = req.query;
      if (!code) return res.status(400).json({ error: 'Código de cupom não informado' });

      const coupon = await prisma.coupon.findUnique({
        where: { code: code.toUpperCase() },
        include: { references: true }
      });

      if (!coupon) {
        return res.status(404).json({ error: 'Cupom não encontrado' });
      }

      if (!coupon.isActive) {
        return res.status(400).json({ error: 'Este cupom não está mais ativo' });
      }

      const now = new Date();
      if (coupon.startDate && new Date(coupon.startDate) > now) {
        return res.status(400).json({ error: 'Este cupom ainda não é válido' });
      }

      if (coupon.endDate && new Date(coupon.endDate) < now) {
        return res.status(400).json({ error: 'Este cupom expirou' });
      }

      if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
        return res.status(400).json({ error: 'Este cupom atingiu o limite de usos' });
      }

      return res.json({ coupon });
    } catch (err) {
      console.error('[COUPONS] Validate error:', err);
      return res.status(500).json({ error: 'Erro ao validar cupom' });
    }
  }
}

module.exports = new CouponController();
