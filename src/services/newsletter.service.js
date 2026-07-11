const { prisma } = require('../config/prisma');
const emailService = require('./email.service');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_SOURCES = new Set(['home', 'footer']);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function assertValidEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !EMAIL_RE.test(normalized) || normalized.length > 254) {
    const err = new Error('E-mail inválido');
    err.status = 400;
    throw err;
  }
  return normalized;
}

function normalizeSource(source) {
  const value = String(source || 'home').trim().toLowerCase();
  return ALLOWED_SOURCES.has(value) ? value : 'home';
}

function buildWelcomeEmailHtml(email) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
      <h2 style="margin:0 0 12px">Bem-vindo à newsletter Space Point</h2>
      <p>Olá! Confirmamos a inscrição do e-mail <strong>${email}</strong>.</p>
      <p>Você receberá novidades, ofertas e lançamentos diretamente na sua caixa de entrada.</p>
      <p style="color:#666;font-size:13px">Se não foi você, ignore este e-mail.</p>
    </div>
  `;
}

async function sendWelcomeEmail(email) {
  await emailService.sendEmail(
    email,
    'Inscrição confirmada — Space Point',
    buildWelcomeEmailHtml(email)
  );
}

async function subscribe({ email, source = 'home', userId = null }) {
  const normalizedEmail = assertValidEmail(email);
  const normalizedSource = normalizeSource(source);

  const existing = await prisma.newsletterSubscriber.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    if (existing.isActive) {
      return { alreadySubscribed: true, subscriber: existing };
    }

    const subscriber = await prisma.newsletterSubscriber.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        source: normalizedSource,
        userId: userId || existing.userId,
      },
    });

    sendWelcomeEmail(normalizedEmail).catch(() => {});
    return { alreadySubscribed: false, reactivated: true, subscriber };
  }

  const subscriber = await prisma.newsletterSubscriber.create({
    data: {
      email: normalizedEmail,
      source: normalizedSource,
      userId: userId || null,
    },
  });

  sendWelcomeEmail(normalizedEmail).catch(() => {});
  return { alreadySubscribed: false, subscriber };
}

async function listSubscribers({ search = '', page = 1, limit = 20, activeOnly = true } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const term = String(search || '').trim();

  const where = {
    ...(activeOnly ? { isActive: true } : {}),
    ...(term
      ? {
          email: { contains: term, mode: 'insensitive' },
        }
      : {}),
  };

  const [subscribers, total] = await Promise.all([
    prisma.newsletterSubscriber.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: safeLimit,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.newsletterSubscriber.count({ where }),
  ]);

  return {
    subscribers,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

async function removeSubscriber(id) {
  const subscriber = await prisma.newsletterSubscriber.findUnique({ where: { id } });
  if (!subscriber) {
    const err = new Error('Inscrito não encontrado');
    err.status = 404;
    throw err;
  }

  await prisma.newsletterSubscriber.update({
    where: { id },
    data: { isActive: false },
  });

  return { success: true };
}

async function exportActiveSubscribers() {
  return prisma.newsletterSubscriber.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    select: {
      email: true,
      source: true,
      createdAt: true,
    },
  });
}

module.exports = {
  subscribe,
  listSubscribers,
  removeSubscriber,
  exportActiveSubscribers,
};
