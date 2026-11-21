const { createSession, readCookies } = require('../lib/session');

const API = 'https://discord.com/api/v10';

function back(res, error) {
  res.writeHead(302, { Location: error ? `/?erreur=${error}` : '/' }).end();
}

// Retour de Discord : on récupère l'identité du joueur, puis on vérifie avec
// le bot qu'il a bien un rôle de l'équipe sur le serveur CloudyCat.
module.exports = async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== readCookies(req).premier_state) return back(res, 'connexion');

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
      })
    });
    if (!tokenRes.ok) return back(res, 'connexion');
    const { access_token } = await tokenRes.json();

    const user = await (await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${access_token}` } })).json();

    const memberRes = await fetch(`${API}/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
    });
    if (!memberRes.ok) return back(res, 'acces');
    const member = await memberRes.json();

    const allowed = (process.env.ALLOWED_ROLE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!member.roles.some((id) => allowed.includes(id))) return back(res, 'acces');

    createSession(res, {
      id: user.id,
      name: member.nick || user.global_name || user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null
    });
    back(res);
  } catch {
    back(res, 'connexion');
  }
};
