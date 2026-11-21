// Infos en jeu à partir du Riot ID, via l'API non officielle HenrikDev (même
// clé que le bot) : rang, bannière de joueur, niveau de compte. Ne demande
// jamais de mot de passe : pseudo + tag publics.
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

async function henrik(path) {
  const res = await fetch(`https://api.henrikdev.xyz/valorant/${path}`, {
    headers: { Authorization: process.env.HENRIKDEV_API_KEY },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return null;
  return (await res.json())?.data ?? null;
}

// Seules les images du CDN Valorant sont gardées.
const image = (url) => (typeof url === 'string' && url.startsWith('https://media.valorant-api.com/') ? url : null);

// { rang: "Diamant 2" | null, carte: url | null, niveau: nombre | null }, ou
// null si le Riot ID est invalide, la clé absente ou l'API injoignable.
async function fetchPlayer(riotId) {
  const [name, tag] = (riotId || '').split('#');
  if (!process.env.HENRIKDEV_API_KEY || !name || !tag) return null;
  const who = `${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;

  try {
    const [mmr, account] = await Promise.all([henrik(`v2/mmr/eu/${who}`), henrik(`v1/account/${who}`)]);
    if (!mmr && !account) return null;

    let rang = null;
    const patched = mmr?.current_data?.currenttierpatched;
    const [, tier, division] = (patched || '').match(/^(\w+)\s*(\d*)$/) || [];
    if (TIERS[tier]) rang = `${TIERS[tier]}${division ? ' ' + division : ''}`;

    return {
      rang,
      carte: image(account?.card?.wide),
      niveau: Number.isInteger(account?.account_level) ? account.account_level : null
    };
  } catch {
    return null;
  }
}

module.exports = { fetchPlayer };
