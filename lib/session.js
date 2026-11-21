const crypto = require('crypto');

// Session signée dans un cookie : { id, name, avatar, exp }. Pas de base de
// sessions à gérer ; la signature HMAC empêche de fabriquer un faux cookie.
const COOKIE = 'premier_session';
const DURATION_S = 12 * 60 * 60;

function sign(value) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('base64url');
}

function readCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function createSession(res, user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + DURATION_S })).toString('base64url');
  res.setHeader('Set-Cookie', cookie(COOKIE, `${payload}.${sign(payload)}`, DURATION_S));
}

function clearSession(res) {
  res.setHeader('Set-Cookie', cookie(COOKIE, '', 0));
}

function getSession(req) {
  const raw = readCookies(req)[COOKIE];
  if (!raw || !process.env.SESSION_SECRET) return null;
  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return user.exp > Date.now() / 1000 ? user : null;
  } catch {
    return null;
  }
}

module.exports = { createSession, clearSession, getSession, readCookies, cookie };
