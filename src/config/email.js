const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendOtpEmail = async (to, code) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; background: #0a0a0a; border-radius: 12px; color: white;">
      <h2 style="text-align: center; color: #06b6d4; margin-bottom: 20px;">Space Point</h2>
      <p style="color: #a1a1aa; text-align: center; margin-bottom: 24px;">Seu código de verificação</p>
      <div style="background: #141417; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 20px;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #06b6d4;">${code}</span>
      </div>
      <p style="color: #71717a; font-size: 12px; text-align: center;">Este código expira em 10 minutos.</p>
      <p style="color: #52525b; font-size: 11px; text-align: center; margin-top: 16px;">Se você não solicitou este código, ignore este email.</p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'Space Point <noreply@spacepoint.com>',
    to,
    subject: 'Seu código de verificação - Space Point',
    html,
  });
};

module.exports = { sendOtpEmail };
