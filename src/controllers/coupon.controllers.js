const { prisma } = require('../config/prisma');
const {
  recordAdminAction,
  AUDIT_ACTIONS,
  requestContext,
} = require('../services/auditLog.service');

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
      const { period = 'all', from, to } = req.query;
      
      let dateFilter = {};
      const now = new Date();

      if (from || to) {
        dateFilter = {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          }
        };
      } else {
        if (period === 'today') {
          dateFilter = { createdAt: { gte: new Date(now.setHours(0,0,0,0)) } };
        } else if (period === '7days') {
          dateFilter = { createdAt: { gte: new Date(now.setDate(now.getDate() - 7)) } };
        } else if (period === '30days') {
          dateFilter = { createdAt: { gte: new Date(now.setDate(now.getDate() - 30)) } };
        }
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
      const { from, to, search, status } = req.query;
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const skip = (page - 1) * limit;

      const coupon = await prisma.coupon.findUnique({
        where: { id },
        include: {
          references: true,
          _count: { select: { usages: true } },
        },
      });

      if (!coupon) return res.status(404).json({ error: 'Cupom não encontrado' });

      const dateFilter = {};
      if (from || to) {
        dateFilter.createdAt = {};
        if (from) dateFilter.createdAt.gte = new Date(String(from));
        if (to) dateFilter.createdAt.lte = new Date(String(to));
      }

      const statsWhere = { couponId: id, ...dateFilter };

      const salesWhere = {
        couponId: id,
        ...dateFilter,
      };

      const searchTerm = String(search || '').trim();
      if (searchTerm) {
        salesWhere.OR = [
          { orderId: { contains: searchTerm, mode: 'insensitive' } },
          { user: { name: { contains: searchTerm, mode: 'insensitive' } } },
          { user: { email: { contains: searchTerm, mode: 'insensitive' } } },
        ];
      }

      const statusFilter = String(status || '').trim().toUpperCase();
      if (statusFilter && statusFilter !== 'ALL') {
        salesWhere.order = { status: statusFilter };
      }

      const [totalUses, aggregated, usagesForConverted, salesTotal, sales] = await Promise.all([
        prisma.couponUsage.count({ where: statsWhere }),
        prisma.couponUsage.aggregate({
          where: statsWhere,
          _sum: { discount: true },
        }),
        prisma.couponUsage.findMany({
          where: statsWhere,
          select: { order: { select: { total: true } } },
        }),
        prisma.couponUsage.count({ where: salesWhere }),
        prisma.couponUsage.findMany({
          where: salesWhere,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: {
            user: { select: { id: true, name: true, email: true, image: true } },
            order: {
              select: {
                id: true,
                status: true,
                total: true,
                subtotal: true,
                discount: true,
                paymentMethod: true,
                createdAt: true,
                paidAt: true,
              },
            },
          },
        }),
      ]);

      const totalConvertedCents = usagesForConverted.reduce(
        (acc, curr) => acc + (curr.order?.total || 0),
        0
      );

      return res.json({
        coupon,
        stats: {
          totalUses,
          totalDiscounted: Number(aggregated._sum.discount || 0),
          totalConverted: totalConvertedCents / 100,
        },
        sales: sales.map((usage) => ({
          id: usage.id,
          discount: Number(usage.discount),
          createdAt: usage.createdAt,
          user: usage.user,
          order: usage.order
            ? {
                ...usage.order,
                total: usage.order.total,
                subtotal: usage.order.subtotal,
                discount: usage.order.discount,
              }
            : null,
        })),
        pagination: {
          page,
          limit,
          total: salesTotal,
          pages: Math.max(1, Math.ceil(salesTotal / limit)),
        },
      });
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

      await recordAdminAction({
        ...requestContext(req),
        action: AUDIT_ACTIONS.COUPON_CREATE,
        targetType: 'coupon',
        targetId: coupon.id,
        metadata: { code: coupon.code, type: coupon.type, value: Number(coupon.value) },
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

      const before = await prisma.coupon.findUnique({ where: { id } });
      if (!before) return res.status(404).json({ error: 'Cupom não encontrado' });

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

      await recordAdminAction({
        ...requestContext(req),
        action: AUDIT_ACTIONS.COUPON_UPDATE,
        targetType: 'coupon',
        targetId: id,
        metadata: {
          code: result.code,
          oldCode: before.code,
          isActive: result.isActive,
          value: Number(result.value),
          oldValue: Number(before.value),
        },
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

      const existing = await prisma.coupon.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: 'Cupom não encontrado' });

      await prisma.coupon.delete({ where: { id } });

      await recordAdminAction({
        ...requestContext(req),
        action: AUDIT_ACTIONS.COUPON_DELETE,
        targetType: 'coupon',
        targetId: id,
        metadata: { code: existing.code },
      });

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

      const { countPendingCouponHolds, normalizeCouponCode } = require('../services/coupon.service');

      const normalized = normalizeCouponCode(code);
      const coupon = await prisma.coupon.findUnique({
        where: { code: normalized },
      });

      const invalid = () => res.status(400).json({ error: 'Cupom inválido' });

      if (!coupon || !coupon.isActive) return invalid();

      const now = new Date();
      if (coupon.startDate && new Date(coupon.startDate) > now) return invalid();
      if (coupon.endDate && new Date(coupon.endDate) < now) return invalid();

      if (coupon.maxUses != null) {
        const pendingHolds = await countPendingCouponHolds(prisma, {
          couponCode: coupon.code,
        });
        if (coupon.usedCount + pendingHolds >= coupon.maxUses) return invalid();
      }

      // Preview mínimo: o desconto definitivo é recalculado no create order
      return res.json({
        coupon: {
          code: coupon.code,
          type: coupon.type,
          value: Number(coupon.value),
          minOrderValue: coupon.minOrderValue != null ? Number(coupon.minOrderValue) : null,
          maxDiscount: coupon.maxDiscount != null ? Number(coupon.maxDiscount) : null,
        },
      });
    } catch (err) {
      console.error('[COUPONS] Validate error:', err);
      return res.status(500).json({ error: 'Erro ao validar cupom' });
    }
  }
}

module.exports = new CouponController();
