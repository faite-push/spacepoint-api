const nodemailer = require('nodemailer');
const { maskEmail } = require('../utils/maskSensitive');

let cachedFromAddress = null;
let cachedFromAt = 0;
const FROM_CACHE_MS = 60_000;

function parseDisplayNameFromEnv() {
  const raw = String(process.env.SMTP_FROM || '').trim();
  if (!raw) return null;
  const quoted = /^"([^"]+)"\s*</.exec(raw);
  if (quoted) return quoted[1].trim();
  const plain = /^([^<]+)</.exec(raw);
  if (plain) return plain[1].trim();
  if (!raw.includes('@')) return raw;
  return null;
}

async function resolveFromAddress() {
  const now = Date.now();
  if (cachedFromAddress && now - cachedFromAt < FROM_CACHE_MS) {
    return cachedFromAddress;
  }

  const smtpUser = String(process.env.SMTP_USER || '').trim();
  let displayName = parseDisplayNameFromEnv() || 'Space Point';

  try {
    const { prisma } = require('../config/prisma');
    const config = await prisma.siteConfig.findUnique({
      where: { id: 'default' },
      select: { storeName: true },
    });
    if (config?.storeName?.trim()) {
      displayName = config.storeName.trim();
    }
  } catch {
    /* prisma indisponível no boot */
  }

  const safeName = displayName.replace(/"/g, "'");
  cachedFromAddress = smtpUser
    ? `"${safeName}" <${smtpUser}>`
    : process.env.SMTP_FROM || `"${safeName}" <noreply@spacepoint.com>`;
  cachedFromAt = now;
  return cachedFromAddress;
}

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  isConfigured() {
    return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  async sendEmail(to, subject, html) {
    if (!this.isConfigured()) {
      console.warn('[email] SMTP não configurado. E-mail ignorado:', subject);
      return false;
    }

    try {
      const from = await resolveFromAddress();
      const info = await this.transporter.sendMail({
        from,
        to,
        subject,
        html,
      });
      console.log(`[email] Enviado: ${subject} → ${maskEmail(to)} (${info.messageId})`);
      return true;
    } catch (error) {
      console.error('[email] Erro ao enviar:', subject, error.message);
      return false;
    }
  }
}

module.exports = new EmailService();
