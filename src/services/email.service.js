const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
            tls: {
                rejectUnauthorized: false
            }
        });
    }

    async sendEmail(to, subject, html) {
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.warn('SMTP credentials not configured. Email skipped:', subject);
            return;
        }

        try {
            const info = await this.transporter.sendMail({
                from: process.env.SMTP_FROM || '"Remicode System" <noreply@remicode.com>',
                to,
                subject,
                html,
            });
            console.log(`Email sent: ${info.messageId}`);
        } catch (error) {
            console.error('Error sending email:', error);
        }
    }

    async sendExpirationWarning(user, daysRemaining) {
    }
}

module.exports = new EmailService();