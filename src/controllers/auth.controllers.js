const { generateToken } = require('../config/jwt');
const { prisma } = require('../config/prisma');
const { sendOtpEmail } = require('../config/email');
const { isSuperOwner } = require('../utils/auth');
const { COOKIE_BASE } = require('../config/cookies');
const axios = require('axios');
const crypto = require('crypto');

const setAuthCookies = (res, user) => {
  const payload = { id: user.id, name: user.name, image: user.image };
  const token = generateToken(payload);
  const csrfToken = crypto.randomBytes(32).toString('hex');


  res.cookie('access_token', token, { ...COOKIE_BASE, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.cookie('csrf_token', csrfToken, { ...COOKIE_BASE, httpOnly: false, maxAge: 7 * 24 * 60 * 60 * 1000 });
};

function sanitizeReturnTo(value) {
  if (!value || typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path.slice(0, 200);
}

function setOAuthReturnCookie(res, returnTo) {
  const safe = sanitizeReturnTo(returnTo);
  if (!safe) return;
  res.cookie('oauth_return_to', safe, { ...COOKIE_BASE, maxAge: 10 * 60 * 1000 });
}

function resolveOAuthRedirect(req, res) {
  const path = sanitizeReturnTo(req.cookies?.oauth_return_to);
  res.clearCookie('oauth_return_to', { path: '/', domain: COOKIE_BASE.domain });
  const base = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return path ? `${base}${path}` : base || '/';
}

const upsertUser = async ({ provider, providerId, name, email, image }) => {
  const where = provider === 'discord'
    ? { discordId: providerId }
    : { googleId: providerId };

  const data = {
    name,
    email: email || null,
    image,
    provider,
    ...(provider === 'discord' ? { discordId: providerId } : { googleId: providerId }),
  };

  return prisma.user.upsert({
    where,
    update: { name, image },
    create: { id: crypto.randomUUID(), ...data },
  });
};

class AuthController {
  redirectDiscord(req, res) {
    setOAuthReturnCookie(res, req.query.returnTo);
    const authUrl = new URL('https://discord.com/oauth2/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', process.env.DISCORD_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', `${process.env.API_URL}/login/discord/callback`);
    authUrl.searchParams.set('scope', 'identify email');
    return res.redirect(authUrl.toString());
  }

  async callbackDiscord(req, res) {
    const { code } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);

    try {
      const tokenRes = await axios.post(
        'https://discord.com/api/oauth2/token',
        new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: `${process.env.API_URL}/login/discord/callback`,
          scope: 'identify email',
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      if (!tokenRes.data.access_token) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=discord_token`);
      }

      const userRes = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
      });

      const { id, username, email, avatar } = userRes.data;
      const image = avatar
        ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${Number(id) % 5}.png`;

      const user = await upsertUser({ provider: 'discord', providerId: id, name: username, email, image });

      setAuthCookies(res, user);
      return res.redirect(resolveOAuthRedirect(req, res));
    } catch (err) {
      console.error('[Discord OAuth Error]', err.response?.data || err.message);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=discord_failed`);
    }
  }

  redirectGoogle(req, res) {
    setOAuthReturnCookie(res, req.query.returnTo);
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', `${process.env.API_URL}/login/google/callback`);
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'select_account');
    return res.redirect(authUrl.toString());
  }

  async callbackGoogle(req, res) {
    const { code } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);

    try {
      const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${process.env.API_URL}/login/google/callback`,
        grant_type: 'authorization_code',
      });

      const { access_token } = tokenRes.data;
      if (!access_token) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=google_token`);
      }

      const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const { id, name, email, picture } = userRes.data;
      const user = await upsertUser({ provider: 'google', providerId: id, name, email, image: picture });

      setAuthCookies(res, user);
      return res.redirect(resolveOAuthRedirect(req, res));
    } catch (err) {
      console.error('[Google OAuth Error]', err.response?.data || err.message);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=google_failed`);
    }
  }

  async getMe(req, res) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          provider: true,
          isAdmin: true,
          balance: true,
          createdAt: true,
          role: {
            include: {
              permissions: true,
            },
          },
        },
      });

      if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

      let csrfToken = req.cookies?.csrf_token;
      if (!csrfToken) {
        csrfToken = crypto.randomBytes(32).toString('hex');
        res.cookie('csrf_token', csrfToken, { ...COOKIE_BASE, httpOnly: false });
      }

      // Se for admin, incluímos os dados completos inclusive permissões
      const response = {
        ...user,
        isSuperOwner: isSuperOwner(user.email),
        permissions: user.role?.permissions.map(p => p.key) || [],
        csrfToken,
      };

      return res.json(response);
    } catch (err) {
      console.error('[getMe Error]', err.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  logout(req, res) {
    const clearCookieBase = {
      httpOnly: COOKIE_BASE.httpOnly,
      secure: COOKIE_BASE.secure,
      sameSite: COOKIE_BASE.sameSite,
      domain: COOKIE_BASE.domain,
      path: COOKIE_BASE.path,
    };

    res.clearCookie('access_token', clearCookieBase);
    res.clearCookie('csrf_token', { ...clearCookieBase, httpOnly: false });
    return res.json({ ok: true });
  }

  async checkAdmin(req, res) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { isAdmin: true },
      });
      return res.json({ isAdmin: user?.isAdmin ?? false });
    } catch (err) {
      return res.status(500).json({ isAdmin: false });
    }
  }

  // ─── OTP (Magic Link) Login ────────────────────────────────────────────────

  async sendOtpCode(req, res) {
    try {
      const { email } = req.body;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Email inválido' });
      }

      // Gerar código de 6 dígitos
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

      // Invalidar códigos antigos do mesmo email
      await prisma.otpCode.updateMany({
        where: { email, used: false },
        data: { used: true },
      });

      // Criar novo código
      await prisma.otpCode.create({
        data: { email, code, expiresAt },
      });

      // Enviar email
      await sendOtpEmail(email, code);

      return res.json({ success: true, message: 'Código enviado' });
    } catch (err) {
      console.error('[sendOtpCode Error]', err.message);
      return res.status(500).json({ error: 'Erro ao enviar código' });
    }
  }

  async verifyOtpCode(req, res) {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        return res.status(400).json({ error: 'Email e código são obrigatórios' });
      }

      // Buscar código válido
      const otpRecord = await prisma.otpCode.findFirst({
        where: {
          email,
          code,
          used: false,
          expiresAt: { gt: new Date() },
        },
      });

      if (!otpRecord) {
        return res.status(400).json({ error: 'Código inválido ou expirado' });
      }

      // Marcar como usado
      await prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { used: true },
      });

      // Buscar ou criar usuário
      let user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        // Criar novo usuário
        user = await prisma.user.create({
          data: {
            id: crypto.randomUUID(),
            email,
            name: email.split('@')[0],
            provider: 'local',
          },
        });
      }

      // Gerar token e cookies
      const payload = { id: user.id, name: user.name, image: user.image };
      const token = generateToken(payload);
      const csrfToken = crypto.randomBytes(32).toString('hex');

      res.cookie('access_token', token, { ...COOKIE_BASE, maxAge: 7 * 24 * 60 * 60 * 1000 });
      res.cookie('csrf_token', csrfToken, { ...COOKIE_BASE, httpOnly: false, maxAge: 7 * 24 * 60 * 60 * 1000 });

      return res.json({
        success: true,
        csrfToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          isAdmin: user.isAdmin,
        },
      });
    } catch (err) {
      console.error('[verifyOtpCode Error]', err.message);
      return res.status(500).json({ error: 'Erro ao verificar código' });
    }
  }
}

module.exports = new AuthController();