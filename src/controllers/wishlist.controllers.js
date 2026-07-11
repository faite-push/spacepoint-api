const { sanitizeString } = require('../utils/sanitize');
const wishlistService = require('../services/wishlist.service');

class WishlistController {
  async listMine(req, res) {
    try {
      const products = await wishlistService.listProductsForUser(req.user.id, req);
      return res.json({ products });
    } catch (err) {
      console.error('[Wishlist.listMine]', err);
      return res.status(500).json({ error: 'Erro ao listar lista de desejos' });
    }
  }

  async sync(req, res) {
    try {
      const productIds = Array.isArray(req.body?.productIds)
        ? req.body.productIds.map((id) => sanitizeString(String(id), 60)).filter(Boolean)
        : [];

      const products = await wishlistService.syncItems(req.user.id, productIds, req);
      return res.json({ products });
    } catch (err) {
      console.error('[Wishlist.sync]', err);
      return res.status(500).json({ error: 'Erro ao sincronizar lista de desejos' });
    }
  }

  async add(req, res) {
    try {
      const productId = sanitizeString(req.body?.productId || '', 60);
      if (!productId) {
        return res.status(400).json({ error: 'productId é obrigatório' });
      }

      await wishlistService.addItem(req.user.id, productId);
      return res.status(201).json({ success: true });
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
      console.error('[Wishlist.add]', err);
      return res.status(500).json({ error: 'Erro ao adicionar à lista de desejos' });
    }
  }

  async remove(req, res) {
    try {
      const productId = sanitizeString(req.params.productId || '', 60);
      if (!productId) {
        return res.status(400).json({ error: 'productId inválido' });
      }

      await wishlistService.removeItem(req.user.id, productId);
      return res.json({ success: true });
    } catch (err) {
      console.error('[Wishlist.remove]', err);
      return res.status(500).json({ error: 'Erro ao remover da lista de desejos' });
    }
  }
}

module.exports = new WishlistController();
