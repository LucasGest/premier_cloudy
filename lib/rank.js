// Rang Valorant à partir du Riot ID, via l'API non officielle HenrikDev (même
// clé que le bot). Ne demande jamais de mot de passe : pseudo + tag publics.
const TIERS = {
  Iron: 'Fer',
  Bronze: 'Bronze',
  Silver: 'Argent',
  Gold: 'Or',
  Platinum: 'Platine',
  Diamond: 'Diamant',
  Ascendant: 'Ascendant',
  Immortal: 'Immortel',
  Radiant: 'Radiant'
};

// "Diamond 2" -> "Diamant 2". null si le rang est introuvable ou l'API absente.
async function fetchRank(riotId) {
  const key = process.env.HENRIKDEV_API_KEY;
  const [name, tag] = riotId.split('#');
  if (!key || !name || !tag) return null;

  try {
    const res = await fetch(
      `https://api.henrikdev.xyz/valorant/v2/mmr/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const patched = (await res.json())?.data?.current_data?.currenttierpatched;
    if (!patched || patched === 'Unrated') return null;
    const [, tier, division] = patched.match(/^(\w+)\s*(\d*)$/) || [];
    return TIERS[tier] ? `${TIERS[tier]}${division ? ' ' + division : ''}` : null;
  } catch {
    return null;
  }
}

module.exports = { fetchRank };
