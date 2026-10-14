// Autenticacao local do dashboard admin (MVP v1).
// Sem dependencias novas: scrypt via node:crypto, sessao em memoria,
// hash persistido no doc `adminUsers`. Niveis: admin (tudo) e viewer (leitura).

const crypto = require('crypto');
const { loadAdminUsers, saveAdminUsers } = require('../services/dataService');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // token -> {username, role, expiresAt}

function hashPassword(password, salt = null) {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), usedSalt, 64).toString('hex');
  return { salt: usedSalt, hash: derived };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  try {
    const derived = crypto.scryptSync(String(password), String(salt), 64);
    const expected = Buffer.from(String(hash), 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'viewer';
}

async function createUser(username, password, role = 'viewer') {
  const name = String(username || '').trim().toLowerCase();
  if (!name || String(password || '').length < 8) {
    throw new Error('Usuario invalido ou senha curta (min. 8).');
  }
  const data = await loadAdminUsers();
  data.users ||= {};
  if (data.users[name]) throw new Error('Usuario ja existe.');
  const { salt, hash } = hashPassword(password);
  data.users[name] = { salt, hash, role: normalizeRole(role), createdAt: new Date().toISOString() };
  await saveAdminUsers(data);
  return { username: name, role: data.users[name].role };
}

async function verifyUser(username, password) {
  const name = String(username || '').trim().toLowerCase();
  const data = await loadAdminUsers();
  const entry = data.users?.[name];
  if (!entry) return null;
  if (!verifyPassword(password, entry.salt, entry.hash)) return null;
  return { username: name, role: normalizeRole(entry.role) };
}

function issueSession(user) {
  pruneSessions();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username: user.username, role: user.role, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const entry = sessions.get(String(token));
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) sessions.delete(String(token));
    return null;
  }
  return { username: entry.username, role: entry.role };
}

function revokeSession(token) {
  if (token) sessions.delete(String(token));
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(token);
  }
}

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function sessionCookieHeader(token) {
  const attrs = ['caps_admin=' + encodeURIComponent(token), 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=43200'];
  return attrs.join('; ');
}

function clearSessionCookieHeader() {
  return 'caps_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function requireAuth(req, res, next) {
  const user = getSessionUser(parseCookies(req).caps_admin);
  if (!user) return res.redirect('/login');
  req.adminUser = user;
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    const user = req.adminUser || getSessionUser(parseCookies(req).caps_admin);
    if (!user) return res.redirect('/login');
    req.adminUser = user;
    if (role === 'admin' && user.role !== 'admin') {
      return res.status(403).send('Acesso restrito a admin.');
    }
    return next();
  };
}

module.exports = {
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  normalizeRole,
  createUser,
  verifyUser,
  issueSession,
  getSessionUser,
  revokeSession,
  pruneSessions,
  parseCookies,
  sessionCookieHeader,
  clearSessionCookieHeader,
  requireAuth,
  requireRole
};
