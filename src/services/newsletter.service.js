const { prisma } = require('../config/prisma');
const emailService = require('./email.service');
const {
  buildEmailDocument,
  DEFAULT_HEADER_HTML,
  DEFAULT_FOOTER_HTML,
  FRONTEND_URL,
} = require('../utils/emailTemplatesSettings');

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
  const storeUrl = FRONTEND_URL;
  const bodyHtml = `<div style="text-align:center;margin-bottom:24px;">
  <h1 style="margin:12px 0 0;font-size:24px;color:#18181b;">Inscrição confirmada</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Bem-vindo à newsletter</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá!</p>
<p style="max-width:520px;color:#52525b;">Confirmamos a inscrição do e-mail <strong>${email}</strong>.</p>
<p style="max-width:520px;color:#52525b;">Você receberá novidades, ofertas e lançamentos diretamente na sua caixa de entrada.</p>
<p style="margin-top:16px;text-align:center;color:#a1a1aa;font-size:12px;">Se não foi você, ignore este e-mail.</p>`;

  return buildEmailDocument({
    headerHtml: DEFAULT_HEADER_HTML,
    footerHtml: DEFAULT_FOOTER_HTML,
    bodyHtml,
    vars: {
      storeName: 'Space Point',
      logoUrl: `${storeUrl}/logo.png`,
      storeUrl,
      unsubscribeUrl: '',
    },
  });
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
