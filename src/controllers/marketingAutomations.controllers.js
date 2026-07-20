const marketing = require('../services/marketingAutomations.service');

class MarketingAutomationsController {
  async metrics(req, res) {
    try {
      const data = await marketing.getAutomationMetrics(req.query);
      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[Marketing.metrics]', err);
      return res.status(status).json({ error: err.message || 'Erro ao carregar métricas' });
    }
  }

  async listCarts(req, res) {
    try {
      const data = await marketing.listAbandonedCarts(req.query);
      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[Marketing.listCarts]', err);
      return res.status(status).json({ error: err.message || 'Erro ao listar carrinhos' });
    }
  }

  async getCart(req, res) {
    try {
      const data = await marketing.getAbandonedCart(req.params.id);
      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[Marketing.getCart]', err);
      return res.status(status).json({ error: err.message || 'Erro ao buscar carrinho' });
    }
  }

  async archiveCart(req, res) {
    try {
      const data = await marketing.archiveAbandonedCart(req.params.id);
      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[Marketing.archiveCart]', err);
      return res.status(status).json({ error: err.message || 'Erro ao arquivar carrinho' });
    }
  }

  async listOrders(req, res) {
    try {
      const data = await marketing.listUnpaidOrders(req.query);
      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[Marketing.listOrders]', err);
      return res.status(status).json({ error: err.message || 'Erro ao listar pedidos' });
    }
  }

  async getOrder(req, res) {
    try {
      const data = await marketing.getUnpaidOrder(req.params.id);
      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[Marketing.getOrder]', err);
      return res.status(status).json({ error: err.message || 'Erro ao buscar pedido' });
    }
  }

  async archiveOrder(req, res) {
    try {
      const data = await marketing.archiveUnpaidOrder(req.params.id);
      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[Marketing.archiveOrder]', err);
      return res.status(status).json({ error: err.message || 'Erro ao arquivar pedido' });
    }
  }

  async createOrderFromCart(req, res) {
    try {
      const data = await marketing.createOrderFromAbandonedCart(req.params.id);
      return res.status(201).json(data);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[Marketing.createOrderFromCart]', err);
      return res.status(status).json({ error: err.message || 'Erro ao criar pedido' });
    }
  }

  async trackOpen(req, res) {
    try {
      await marketing.trackEmailOpen(req.params.token);
      const pixel = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
      );
      res.set('Content-Type', 'image/gif');
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return res.send(pixel);
    } catch {
      return res.status(204).end();
    }
  }

  async trackClick(req, res) {
    try {
      const url = await marketing.trackEmailClick(req.params.token);
      if (!url) return res.redirect(302, process.env.FRONTEND_URL || '/');
      return res.redirect(302, url);
    } catch {
      return res.redirect(302, process.env.FRONTEND_URL || '/');
    }
  }

  async recoverCart(req, res) {
    try {
      const token = String(req.params.token || req.query.token || '').trim();
      const cart = await marketing.getCartByRecoveryToken(token);
      if (!cart) {
        return res.status(404).json({ error: 'Carrinho de recuperação não encontrado' });
      }
      await marketing.markCartRecovered(token);
      return res.json({
        cartId: cart.id,
        couponCode: cart.couponCode,
        items: cart.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          name: item.variant?.name
            ? `${item.product?.name} — ${item.variant.name}`
            : item.product?.name,
          image: item.product?.imageUrl || null,
          price: item.unitPrice,
          slug: item.product?.slug || null,
        })),
      });
    } catch (err) {
      console.error('[Marketing.recoverCart]', err);
      return res.status(500).json({ error: 'Erro ao recuperar carrinho' });
    }
  }

  async getSettings(req, res) {
    try {
      const data = await marketing.getAutomationSettings();
      return res.json(data);
    } catch (err) {
      console.error('[Marketing.getSettings]', err);
      return res.status(500).json({ error: 'Erro ao carregar configurações' });
    }
  }

  async updateSettings(req, res) {
    try {
      const data = await marketing.updateAutomationSettings(req.body ?? {});
      return res.json(data);
    } catch (err) {
      console.error('[Marketing.updateSettings]', err);
      return res.status(500).json({ error: err.message || 'Erro ao salvar configurações' });
    }
  }
}

module.exports = new MarketingAutomationsController();
