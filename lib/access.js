const { getSession, clearSession } = require('./session');

// Vérifie auprès de Discord (avec le token du bot) que le joueur est toujours
// sur le serveur avec un rôle de l'équipe. Résultat gardé 5 minutes : retirer
// le rôle sur Discord coupe l'accès au site en 5 minutes au plus.
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

// Renvoie le membre Discord s'il a accès, sinon null.
async function memberWithAccess(userId) {
  const member = await fetchMember(userId);
  const ok = Boolean(member?.roles?.some((id) => allowedRoles().includes(id)));
  cache.set(userId, { ok, until: Date.now() + CACHE_MS });
  return ok ? member : null;
}

async function hasAccess(userId) {
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) return hit.ok;
  try {
    return Boolean(await memberWithAccess(userId));
  } catch {
    // Discord injoignable : on garde la dernière réponse connue, sinon on refuse.
    return hit ? hit.ok : false;
  }
}

// Session valide ET rôle toujours présent. Répond lui-même 401/403 sinon.
async function requireUser(req, res) {
  const user = getSession(req);
  if (!user) {
    res.status(401).json({ error: 'non connecté' });
    return null;
  }
  if (!(await hasAccess(user.id))) {
    clearSession(res);
    res.status(403).json({ error: 'accès retiré' });
    return null;
  }
  return user;
}

module.exports = { memberWithAccess, requireUser };
