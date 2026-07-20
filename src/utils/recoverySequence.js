/**
 * Utilitários da régua multi-delay (carrinho / produto / pedido cancelado).
 * sentMap: { "1": "ISO", "12": "ISO", ... } — chave = horas do delay.
 */

function parseSentMap(raw, legacySentAt = null, legacyDelayHint = null) {
  const map = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const hours = Number(key);
      if (Number.isFinite(hours) && hours > 0 && value) {
        map[hours] = value;
      }
    }
  }

  // Legado: um único envio sem JSON → assume o menor delay configurado (ou 1h)
  if (Object.keys(map).length === 0 && legacySentAt) {
    const hours = Number(legacyDelayHint) > 0 ? Number(legacyDelayHint) : 1;
    map[hours] = legacySentAt;
  }

  return map;
}

function countSentEmails(raw, legacySentAt = null) {
  const map = parseSentMap(raw, legacySentAt, 1);
  return Object.keys(map).length;
}

function mergeSentMap(existingMap, delayHours, at = new Date()) {
  const hours = Number(delayHours);
  if (!Number.isFinite(hours) || hours <= 0) return { ...(existingMap || {}) };
  return {
    ...(existingMap || {}),
    [String(hours)]: at.toISOString(),
  };
}

/**
 * Retorna o próximo delay devido, ou null.
 * @param {object} opts
 * @param {number[]} opts.delays - lista ordenável de horas
 * @param {Record<number, unknown>} opts.sentMap
 * @param {Date|string} opts.anchorDate - lastActivityAt / lastViewedAt / cancelledAt
 * @param {number} [opts.inactivityMinutes] - só bloqueia o 1º e-mail da régua (carrinho)
 * @param {Date} [opts.now]
 */
function nextDueDelay({ delays, sentMap, anchorDate, inactivityMinutes = 0, now = new Date() }) {
  const sorted = [...(delays || [])]
    .map((h) => Number(h))
    .filter((h) => Number.isFinite(h) && h > 0)
    .sort((a, b) => a - b);

  if (!sorted.length || !anchorDate) return null;

  const nowMs = now.getTime();
  const anchorMs = new Date(anchorDate).getTime();
  if (!Number.isFinite(anchorMs)) return null;

  const sent = sentMap || {};
  const hasAnySent = Object.keys(sent).length > 0;

  for (let i = 0; i < sorted.length; i++) {
    const hours = sorted[i];
    if (sent[hours]) continue;

    const dueAt = anchorMs + hours * 60 * 60 * 1000;
    if (nowMs < dueAt) continue;

    // Primeiro disparo da régua: respeita inatividade (ex.: carrinho)
    if (!hasAnySent && inactivityMinutes > 0) {
      const inactiveDue = anchorMs + inactivityMinutes * 60 * 1000;
      if (nowMs < inactiveDue) continue;
    }

    return {
      delayHours: hours,
      stepIndex: i + 1,
      stepTotal: sorted.length,
    };
  }

  return null;
}

/** Chave de template por etapa (step1 = base). */
function sequenceTemplateKey(baseKey, stepIndex = 1) {
  const step = Math.max(1, Number(stepIndex) || 1);
  if (step <= 1) return baseKey;
  return `${baseKey}_step${step}`;
}

module.exports = {
  parseSentMap,
  countSentEmails,
  mergeSentMap,
  nextDueDelay,
  sequenceTemplateKey,
};
