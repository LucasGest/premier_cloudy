const crypto = require('crypto');
const { createSession, readCookies, cookie, addCookie } = require('../lib/session');
const { memberWithAccess } = require('../lib/access');

const API = 'https://discord.com/api/v10';

function back(res, error) {
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: error ? `/?erreur=${error}` : '/' }).end();
}

function sameState(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Retour de Discord : on récupère l'identité du joueur, puis on vérifie avec
// le bot qu'il a bien un rôle de l'équipe sur le serveur CloudyCat.
module.exports = async (req, res) => {
  const { code, state } = req.query;
  const expected = readCookies(req)['__Host-premier_state'];
  addCookie(res, cookie('__Host-premier_state', '', 0)); // usage unique
  if (typeof code !== 'string' || !sameState(state, expected)) return back(res, 'connexion');

  try {
    const tokenRes = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.SITE_URL}/api/callback`
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!tokenRes.ok) return back(res, 'connexion');
    const { access_token } = await tokenRes.json();

    const userRes = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(8000) });
    if (!userRes.ok) return back(res, 'connexion');
    const user = await userRes.json();
    if (!/^\d{5,25}$/.test(user.id || '')) return back(res, 'connexion');

    const member = await memberWithAccess(user.id);
    if (!member) return back(res, 'acces');

    createSession(res, {
      id: user.id,
      name: String(member.nick || user.global_name || user.username).slice(0, 40),
      avatar: /^(a_)?[0-9a-f]{32}$/.test(user.avatar || '') ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null
    });
    back(res);
  } catch {
    back(res, 'connexion');
  }
};
