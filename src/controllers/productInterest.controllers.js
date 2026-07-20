const { prisma } = require('../config/prisma');

class ProductInterestController {
  async trackView(req, res) {
    try {
      const body = req.body ?? {};
      const result = await require('../services/productInterest.service').trackProductView({
        visitorId: body.visitorId,
        productId: body.productId,
        variantId: body.variantId,
        email: body.email,
        customerName: body.customerName,
        userId: req.user?.id || body.userId || null,
        userEmail: req.user?.email || null,
        userName: req.user?.name || null,
      });
      return res.json(result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[ProductInterest.trackView]', err);
      return res.status(status).json({ error: err.message || 'Erro ao registrar visualização' });
    }
  }
}

module.exports = new ProductInterestController();
