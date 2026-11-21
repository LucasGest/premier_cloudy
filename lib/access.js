const { getSession, clearSession } = require('./session');

// Identifiants Discord publics (pas des secrets).
const IGL_ROLE_ID = '1573715872785371187';
// Administrateurs du site : tous les droits, dont les matchs.
const ADMIN_USER_IDS = ['251015486953750528'];

// Vérifie auprès de Discord (avec le token du bot) que le joueur est toujours
// sur le serveur avec un rôle de l'équipe. Résultat gardé 5 minutes : retirer
// un rôle sur Discord se répercute sur le site en 5 minutes au plus.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

async function fetchMember(userId) {
  const res = await fetch(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    signal: AbortSignal.timeout(5000)
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Discord ${res.status}`);
  return res.json();
}

function allowedRoles() {
  return (process.env.ALLOWED_ROLE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Droits d'un membre : accès au site, IGL, administrateur.
function rightsOf(userId, member) {
  const roles = member?.roles || [];
  return {
    ok: roles.some((id) => allowedRoles().includes(id)),
    igl: roles.includes(IGL_ROLE_ID),
    admin: ADMIN_USER_IDS.includes(userId)
  };
}

// Renvoie le membre Discord s'il a accès, sinon null.
async function memberWithAccess(userId) {
  const member = await fetchMember(userId);
  const rights = rightsOf(userId, member);
  cache.set(userId, { rights, until: Date.now() + CACHE_MS });
  return rights.ok ? member : null;
}

async function rightsFor(userId) {
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) return hit.rights;
  try {
    await memberWithAccess(userId);
    return cache.get(userId).rights;
  } catch {
    // Discord injoignable : on garde la dernière réponse connue, sinon on refuse.
    return hit ? hit.rights : { ok: false, igl: false, admin: false };
  }
}

// Session valide ET rôle toujours présent. Répond lui-même 401/403 sinon.
// Renvoie l'utilisateur avec ses droits : { id, name, avatar, igl, admin }.
async function requireUser(req, res) {
  const user = getSession(req);
  if (!user) {
    res.status(401).json({ error: 'non connecté' });
    return null;
  }
  const rights = await rightsFor(user.id);
  if (!rights.ok) {
    clearSession(res);
    res.status(403).json({ error: 'accès retiré' });
    return null;
  }
  return { ...user, igl: rights.igl || rights.admin, admin: rights.admin };
}

module.exports = { memberWithAccess, requireUser };
