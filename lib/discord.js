// Messages du bot sur Discord, envoyés depuis le site.
const RESULTS_CHANNEL_ID = '1573715882301984819'; // 📊・résultats

const MAP_NAMES = (id) => id.charAt(0).toUpperCase() + id.slice(1);

// Un match importé -> message de résultat. Le texte vient du jeu : on retire
// les mentions possibles et on n'autorise aucun ping.
async function postResult(match) {
  const win = match.scoreNous > match.scoreEux;
  const best = (match.joueurs || []).filter((j) => j.equipe)[0];
  const clean = (s) => String(s).replace(/[@#<>`*_~|]/g, '').slice(0, 60);
  const lines = [
    `**${win ? 'Victoire' : match.scoreNous === match.scoreEux ? 'Égalité' : 'Défaite'} ${match.scoreNous}-${match.scoreEux}** sur ${MAP_NAMES(match.map)}${match.adversaire ? ` contre ${clean(match.adversaire)}` : ''}`,
    best ? `Meilleur joueur : ${clean(best.nom)} (${best.agent}, ACS ${best.acs}, ${best.kills}/${best.deaths}/${best.assists})` : null,
    `Stats et debrief : ${process.env.SITE_URL}`
  ].filter(Boolean);

  const res = await fetch(`https://discord.com/api/v10/channels/${RESULTS_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: lines.join('\n'), allowed_mentions: { parse: [] }, flags: 4 }),
    signal: AbortSignal.timeout(5000)
  });
  return res.ok;
}

module.exports = { postResult };
