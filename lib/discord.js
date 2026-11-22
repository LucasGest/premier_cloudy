// Messages du bot sur Discord, envoyés depuis le site.
const RESULTS_CHANNEL_ID = '1573715882301984819'; // 📊・résultats

const STRATS_CHANNEL_ID = '1573715880418869270'; // 🧠・strats

const MAP_NAMES = (id) => id.charAt(0).toUpperCase() + id.slice(1);
// Texte saisi par un joueur ou venu du jeu : on retire les mentions possibles.
const clean = (s) => String(s).replace(/[@#<>`*_~|]/g, '').slice(0, 60);

async function post(channelId, content) {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }),
    signal: AbortSignal.timeout(5000)
  });
  return res.ok;
}

// Une strat créée ou modifiée -> annonce dans le salon des strats.
const COTES = { attaque: 'Attaque', defense: 'Défense', retake: 'Retake' };
function postStrat(strat, isNew) {
  const where = [COTES[strat.cote], strat.site && `site ${strat.site}`].filter(Boolean).join(', ');
  const lines = [
    `**${isNew ? 'Nouvelle strat' : 'Strat modifiée'}** sur ${MAP_NAMES(strat.map)} : ${clean(strat.nom)}${where ? ` (${where})` : ''}`,
    strat.agents?.length ? `Agents : ${strat.agents.map(clean).join(', ')}` : null,
    `Par ${clean(strat.updatedBy)}. À voir sur ${process.env.SITE_URL}`
  ].filter(Boolean);
  return post(STRATS_CHANNEL_ID, lines.join('\n'));
}

// Une séance d'entraînement créée -> annonce dans le salon des entraînements.
const TRAINING_CHANNEL_ID = '1574011774783721555'; // 🏋️・entraînements
function postTraining(s) {
  const day = new Date(`${s.date}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const duree = s.duree >= 60 ? `${Math.floor(s.duree / 60)} h${s.duree % 60 ? String(s.duree % 60).padStart(2, '0') : ''}` : `${s.duree} min`;
  const lines = [
    `**Entraînement ${s.type}** le ${day} à ${s.heure.replace(':', 'h')} (${duree})`,
    s.notes ? clean(s.notes.replace(/\s+/g, ' ')).slice(0, 200) : null,
    `Planifié par ${clean(s.updatedBy)}. Indiquez votre présence sur ${process.env.SITE_URL}`
  ].filter(Boolean);
  return post(TRAINING_CHANNEL_ID, lines.join('\n'));
}

// Un match importé -> message de résultat. Aucun ping autorisé.
async function postResult(match) {
  const win = match.scoreNous > match.scoreEux;
  const best = (match.joueurs || []).filter((j) => j.equipe)[0];
  const lines = [
    `**${win ? 'Victoire' : match.scoreNous === match.scoreEux ? 'Égalité' : 'Défaite'} ${match.scoreNous}-${match.scoreEux}** sur ${MAP_NAMES(match.map)}${match.adversaire ? ` contre ${clean(match.adversaire)}` : ''}`,
    best ? `Meilleur joueur : ${clean(best.nom)} (${best.agent}, ACS ${best.acs}, ${best.kills}/${best.deaths}/${best.assists})` : null,
    `Stats et debrief : ${process.env.SITE_URL}`
  ].filter(Boolean);
  return post(RESULTS_CHANNEL_ID, lines.join('\n'));
}

module.exports = { postResult, postStrat, postTraining };
