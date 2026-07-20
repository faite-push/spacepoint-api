const { sanitizeString } = require('../utils/sanitize');
const cartService = require('../services/cart.service');

class CartController {
  async sync(req, res) {
    try {
      const userId = req.user?.id || null;
      const visitorId = sanitizeString(req.body?.visitorId || '', 80) || null;
      const couponCode = sanitizeString(req.body?.couponCode || '', 64) || null;
      const email = sanitizeString(req.body?.email || '', 160) || null;
      const customerName = sanitizeString(req.body?.customerName || '', 120) || null;

      const items = Array.isArray(req.body?.items)
        ? req.body.items.map((item) => ({
            productId: sanitizeString(item?.productId || '', 80),
            variantId: item?.variantId ? sanitizeString(item.variantId, 80) : null,
            quantity: Number(item?.quantity) || 1,
          }))
        : [];

      const result = await cartService.syncCart({
        userId,
        visitorId,
        email,
        customerName,
        couponCode,
        items,
        userEmail: req.user?.email,
        userName: req.user?.name,
      });

      return res.json(result);
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[Cart.sync]', err);
      return res.status(500).json({ error: 'Erro ao sincronizar carrinho' });
    }
  }

  async captureEmail(req, res) {
    try {
      const userId = req.user?.id || null;
      const visitorId = sanitizeString(req.body?.visitorId || '', 80) || null;
      const email = sanitizeString(req.body?.email || '', 160) || null;
      const customerName = sanitizeString(req.body?.customerName || '', 120) || null;
      const phone = sanitizeString(req.body?.phone || '', 32) || null;
      const document = sanitizeString(req.body?.document || req.body?.cpf || '', 32) || null;

      const result = await cartService.captureEmail({
        userId,
        visitorId,
        email,
        customerName,
        phone,
        document,
        userEmail: req.user?.email,
        userName: req.user?.name,
      });

      return res.json(result);
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[Cart.captureEmail]', err);
      return res.status(500).json({ error: 'Erro ao salvar e-mail do carrinho' });
    }
  }

  async clear(req, res) {
    try {
      const userId = req.user?.id || null;
      const visitorId = sanitizeString(req.body?.visitorId || req.query?.visitorId || '', 80) || null;

      const result = await cartService.markConverted({ userId, visitorId });
      return res.json(result);
    } catch (err) {
      console.error('[Cart.clear]', err);
      return res.status(500).json({ error: 'Erro ao limpar carrinho abandonado' });
    }
  }
}

module.exports = new CartController();
