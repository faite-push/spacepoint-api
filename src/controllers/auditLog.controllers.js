const { sanitizeString } = require('../utils/sanitize');
const { listAdminAuditLogs, AUDIT_ACTIONS, ACTION_LABELS } = require('../services/auditLog.service');

class AuditLogController {
  async list(req, res) {
    try {
      const action = sanitizeString(req.query?.action || '', 80) || undefined;
      const actorUserId = sanitizeString(req.query?.actorUserId || '', 80) || undefined;
      const targetId = sanitizeString(req.query?.targetId || '', 120) || undefined;
      const from = req.query?.from ? String(req.query.from) : undefined;
      const to = req.query?.to ? String(req.query.to) : undefined;
      const page = Number(req.query?.page) || 1;
      const limit = Number(req.query?.limit) || 30;

      const result = await listAdminAuditLogs({
        action,
        actorUserId,
        targetId,
        from,
        to,
        page,
        limit,
      });

      return res.json({
        ...result,
        actions: Object.values(AUDIT_ACTIONS),
        actionLabels: ACTION_LABELS,
      });
    } catch (err) {
      console.error('[AuditLog.list]', err);
      return res.status(500).json({ error: 'Erro ao listar auditoria' });
    }
  }
}

module.exports = new AuditLogController();
