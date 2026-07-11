const analyticsService = require('../services/analytics.service');

class AnalyticsController {
  async trackVisit(req, res) {
    try {
      const result = await analyticsService.recordVisit({
        visitorId: req.body?.visitorId,
        path: req.body?.path,
        referrer: req.body?.referrer,
        userAgent: req.headers['user-agent'],
        userId: req.user?.id,
      });

      return res.status(result.recorded ? 201 : 200).json({ success: true, ...result });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Falha ao registrar visita' });
    }
  }
}

module.exports = new AnalyticsController();
