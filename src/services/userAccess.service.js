const { prisma } = require('../config/prisma');

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const lastTouchByUser = new Map();

/**
 * Atualiza lastAccessAt com throttle (máx. 1x a cada 5 min por usuário).
 */
function touchLastAccess(userId) {
  if (!userId) return;

  const now = Date.now();
  const prev = lastTouchByUser.get(userId) || 0;
  if (now - prev < TOUCH_INTERVAL_MS) return;

  lastTouchByUser.set(userId, now);

  prisma.user
    .update({
      where: { id: userId },
      data: { lastAccessAt: new Date() },
    })
    .catch((err) => {
      console.error('[touchLastAccess]', err.message);
      lastTouchByUser.delete(userId);
    });
}

module.exports = {
  touchLastAccess,
};
