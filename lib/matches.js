const { henrik } = require('./rank');

// Import des matchs Premier depuis HenrikDev. On lit l'historique Premier de
// chaque joueur du site, puis on ne garde que les matchs où au moins
// MIN_PLAYERS joueurs du site étaient dans la même équipe : les matchs joués
// avec une ancienne équipe ne remontent pas.
const MIN_PLAYERS = 3;

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

// joueurs : { discordId: fiche } ; renvoie [{ id, data }] prêts à enregistrer.
async function fetchTeamMatches(joueurs) {
  const byPuuid = new Map();
  for (const [discordId, p] of Object.entries(joueurs)) if (p.puuid) byPuuid.set(p.puuid, { ...p, discordId });
  if (byPuuid.size < MIN_PLAYERS) return [];

  // Un appel par joueur, l'un après l'autre (limite de débit de l'API).
  const matches = new Map();
  for (const puuid of byPuuid.keys()) {
    const list = await henrik(`v4/by-puuid/matches/eu/pc/${puuid}?mode=premier&size=10`).catch(() => null);
    for (const m of list || []) if (m?.metadata?.match_id) matches.set(m.metadata.match_id, m);
  }

  const out = [];
  for (const [matchId, m] of matches) {
    if (!/^[0-9a-f-]{36}$/.test(matchId) || !m.metadata.is_completed) continue;
    const ours = m.players.filter((pl) => byPuuid.has(pl.puuid));
    // Notre côté : celui où se trouvent le plus de joueurs du site.
    const sides = {};
    for (const pl of ours) sides[pl.team_id] = (sides[pl.team_id] || 0) + 1;
    const [side, count] = Object.entries(sides).sort((a, b) => b[1] - a[1])[0] || [];
    if (!side || count < MIN_PLAYERS) continue;

    const us = m.teams.find((t) => t.team_id === side);
    const them = m.teams.find((t) => t.team_id !== side);
    const rounds = (us?.rounds?.won || 0) + (us?.rounds?.lost || 0);
    const mapId = String(m.metadata.map?.name || '').toLowerCase();
    if (!/^[a-z]{2,20}$/.test(mapId)) continue;

    const joueurs = m.players
      .filter((pl) => pl.team_id === side)
      .map((pl) => {
        const s = pl.stats || {};
        const shots = (s.headshots || 0) + (s.bodyshots || 0) + (s.legshots || 0);
        const site = byPuuid.get(pl.puuid);
        return {
          nom: String(site?.discord || `${pl.name}#${pl.tag}`).slice(0, 40),
          agent: String(pl.agent?.name || '').slice(0, 20),
          kills: s.kills || 0,
          deaths: s.deaths || 0,
          assists: s.assists || 0,
          hs: pct(s.headshots || 0, shots),
          acs: rounds ? Math.round((s.score || 0) / rounds) : 0,
          equipe: Boolean(site),
          // Fiche du site correspondante : sert aux stats moyennes de la card joueur.
          id: site?.discordId || null
        };
      })
      .sort((a, b) => b.acs - a.acs);

    out.push({
      id: `hd-${matchId}`,
      data: {
        date: String(m.metadata.started_at || '').slice(0, 10),
        map: mapId,
        adversaire: String(them?.premier_roster?.name || '').trim().slice(0, 60),
        scoreNous: us?.rounds?.won || 0,
        scoreEux: them?.rounds?.won || 0,
        joueurs,
        source: 'auto',
        matchId
      }
    });
  }
  return out;
}

module.exports = { fetchTeamMatches, MIN_PLAYERS };
