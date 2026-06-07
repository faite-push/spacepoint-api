const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class AdminPaymentsController {
  /**
   * GET /v2/api/admin/payments
   */
  async list(req, res) {
    try {
      const { page = 1, limit = 10, status, from, to } = req.query;
      const skip = (page - 1) * limit;

      const where = {};
      if (status) where.status = status;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lt = new Date(to);
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          skip: parseInt(skip),
          take: parseInt(limit),
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { name: true, email: true } },
            order: { select: { id: true, status: true } }
          }
        }),
        prisma.payment.count({ where })
      ]);

      return res.json({
        data: payments,
        meta: {
          total,
          page: parseInt(page),
          lastPage: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      console.error('[AdminPayments.list]', err);
      return res.status(500).json({ error: 'Erro ao listar pagamentos' });
    }
  }

  /**
   * GET /v2/api/admin/payments/:id
   */
  async details(req, res) {
    try {
      const { id } = req.params;
      const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
          user: { select: { name: true, email: true, balance: true } },
          order: { 
            include: { 
              items: { include: { product: { select: { name: true } } } } 
            } 
          }
        }
      });

      if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado' });

      return res.json(payment);
    } catch (err) {
      console.error('[AdminPayments.details]', err);
      return res.status(500).json({ error: 'Erro ao buscar detalhes do pagamento' });
    }
  }

  /**
   * PATCH /v2/api/admin/payments/:id/refund
   */
  async refund(req, res) {
    try {
      const { id } = req.params;
      const payment = await prisma.payment.findUnique({ where: { id } });

      if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado' });
      if (payment.status !== 'PAID') return res.status(400).json({ error: 'Apenas pagamentos pagos podem ser reembolsados' });

      // Atualiza pagamento e pedido
      await prisma.$transaction([
        prisma.payment.update({ where: { id }, data: { status: 'REFUNDED' } }),
        ...(payment.orderId ? [prisma.order.update({ where: { id: payment.orderId }, data: { status: 'REFUNDED' } })] : [])
      ]);

      return res.json({ message: 'Pagamento reembolsado com sucesso' });
    } catch (err) {
      console.error('[AdminPayments.refund]', err);
      return res.status(500).json({ error: 'Erro ao processar reembolso' });
    }
  }
}

module.exports = new AdminPaymentsController();
