const { prisma } = require('../config/prisma');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const { generateToken, verifyToken } = require('../config/jwt');
const { COOKIE_BASE } = require('../config/cookies');

const PREAUTH_COOKIE = 'preauth_token';

function parseAllowlist() {
  const raw = process.env.ADMIN_ALLOWED_EMAILS || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isEmailAllowed(email) {
  const allowlist = parseAllowlist();
  if (allowlist.length === 0) return false;
  return allowlist.includes(String(email || '').trim().toLowerCase());
}

function setSessionCookies(res, user) {
  const payload = { id: user.id, name: user.name, image: user.image, isAdmin: true };
  const token = generateToken(payload, { expiresIn: '2h' });
  const csrfToken = crypto.randomBytes(32).toString('hex');

  res.cookie('access_token', token, { ...COOKIE_BASE, maxAge: 2 * 60 * 60 * 1000 });
  res.cookie('csrf_token', csrfToken, { ...COOKIE_BASE, httpOnly: false, maxAge: 2 * 60 * 60 * 1000 });
}

function setPreauthCookie(res, user, stage) {
  const token = generateToken({ id: user.id, stage }, { expiresIn: '10m' });
  res.cookie(PREAUTH_COOKIE, token, { ...COOKIE_BASE, maxAge: 10 * 60 * 1000 });
}

function clearAuthCookies(res) {
  res.clearCookie('access_token', { ...COOKIE_BASE });
  res.clearCookie('csrf_token', { ...COOKIE_BASE, httpOnly: false });
  res.clearCookie(PREAUTH_COOKIE, { ...COOKIE_BASE });
}

async function getPreauthUser(req) {
  const token = req.cookies?.[PREAUTH_COOKIE];
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    if (!payload?.id) return null;
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return null;
    return { user, stage: payload.stage };
  } catch {
    return null;
  }
}

class AdminAuthController {
  async login(req, res) {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    if (!isEmailAllowed(email)) {
      return res.status(403).json({ error: 'Email não permitido' });
    }

    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!user?.isAdmin || !user.passwordHash) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

    if (!user.mfaEnabled) {
      setPreauthCookie(res, user, 'setup');
      return res.json({ mfaRequired: true, mfaSetupRequired: true });
    }

    setPreauthCookie(res, user, 'verify');
    return res.json({ mfaRequired: true, mfaSetupRequired: false });
  }

  async mfaSetup(req, res) {
    const preauth = await getPreauthUser(req);
    if (!preauth || preauth.stage !== 'setup') {
      return res.status(401).json({ error: 'Sessão de pré-autenticação inválida' });
    }

    const { user } = preauth;

    const secretObj = speakeasy.generateSecret({ length: 20 });
    const secret = secretObj.base32;
    const issuer = process.env.ADMIN_MFA_ISSUER || 'Sortebux Admin';
    const accountName = user.email || user.id;
    const otpauthUrl = speakeasy.otpauthURL({
      secret,
      label: accountName,
      issuer,
      encoding: 'base32',
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaSecret: secret,
        provider: user.provider || 'local',
      },
    });

    return res.json({ secret, otpauthUrl });
  }

  async mfaVerify(req, res) {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Código é obrigatório' });

    const preauth = await getPreauthUser(req);
    if (!preauth) return res.status(401).json({ error: 'Sessão de pré-autenticação inválida' });

    const { user, stage } = preauth;
    if (!user.mfaSecret) return res.status(400).json({ error: 'MFA não configurado' });

    const ok = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: String(code).replace(/\s+/g, ''),
      window: 1,
    });
    if (!ok) return res.status(401).json({ error: 'Código inválido' });

    if (stage === 'setup') {
      await prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: true, provider: user.provider || 'local' },
      });
    }

    setSessionCookies(res, user);
    res.clearCookie(PREAUTH_COOKIE, { ...COOKIE_BASE });
    return res.json({ ok: true });
  }

  logout(req, res) {
    clearAuthCookies(res);
    return res.json({ ok: true });
  }
}

module.exports = new AdminAuthController();