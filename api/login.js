const crypto = require('crypto');
const { cookie } = require('../lib/session');

// Envoie le joueur sur la page d'autorisation Discord. Le "state" aléatoire,
// gardé dans un cookie, est revérifié au retour pour bloquer les liens piégés.
module.exports = (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: `${process.env.SITE_URL}/api/callback`,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none'
  });
  res.setHeader('Set-Cookie', cookie('premier_state', state, 600));
  res.writeHead(302, { Location: `https://discord.com/oauth2/authorize?${params}` }).end();
};
