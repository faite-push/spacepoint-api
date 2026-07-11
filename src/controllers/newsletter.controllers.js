const { sanitizeString } = require('../utils/sanitize');
const newsletterService = require('../services/newsletter.service');

class NewsletterController {
  async subscribe(req, res) {
    try {
      const email = sanitizeString(req.body?.email || '', 254);
      const source = sanitizeString(req.body?.source || 'home', 20);

      const result = await newsletterService.subscribe({
        email,
        source,
        userId: req.user?.id || null,
      });

      if (result.alreadySubscribed) {
        return res.json({
          success: true,
          alreadySubscribed: true,
          message: 'Este e-mail já está inscrito na newsletter.',
        });
      }

      return res.status(201).json({
        success: true,
        message: result.reactivated
          ? 'Inscrição reativada com sucesso!'
          : 'Inscrição realizada com sucesso!',
      });
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[Newsletter.subscribe]', err);
      return res.status(500).json({ error: 'Erro ao inscrever na newsletter' });
    }
  }

  async listSubscribers(req, res) {
    try {
      const search = sanitizeString(req.query.search || '', 120);
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      const result = await newsletterService.listSubscribers({ search, page, limit });
      return res.json(result);
    } catch (err) {
      console.error('[Newsletter.listSubscribers]', err);
      return res.status(500).json({ error: 'Erro ao listar inscritos' });
    }
  }

  async removeSubscriber(req, res) {
    try {
      const id = sanitizeString(req.params.id || '', 60);
      if (!id) return res.status(400).json({ error: 'ID inválido' });

      await newsletterService.removeSubscriber(id);
      return res.json({ success: true });
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
      console.error('[Newsletter.removeSubscriber]', err);
      return res.status(500).json({ error: 'Erro ao remover inscrito' });
    }
  }

  async exportSubscribers(req, res) {
    try {
      const rows = await newsletterService.exportActiveSubscribers();
      const header = 'email,source,createdAt';
      const lines = rows.map((row) => {
        const createdAt = row.createdAt.toISOString();
        return `"${row.email.replace(/"/g, '""')}","${row.source}","${createdAt}"`;
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="newsletter-subscribers.csv"');
      return res.send([header, ...lines].join('\n'));
    } catch (err) {
      console.error('[Newsletter.exportSubscribers]', err);
      return res.status(500).json({ error: 'Erro ao exportar inscritos' });
    }
  }
}

module.exports = new NewsletterController();
