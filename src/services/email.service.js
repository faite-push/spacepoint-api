const nodemailer = require('nodemailer');

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
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || '"Space Point" <noreply@spacepoint.com>',
        to,
        subject,
        html,
      });
      console.log(`[email] Enviado: ${subject} → ${to} (${info.messageId})`);
      return true;
    } catch (error) {
      console.error('[email] Erro ao enviar:', subject, error.message);
      return false;
    }
  }
}

module.exports = new EmailService();
