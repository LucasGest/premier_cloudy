const { requireUser } = require('../lib/access');
const { items } = require('../lib/firebase');
const { fetchPlayer } = require('../lib/rank');

// POST /api/ranks : relit en jeu rang, bannière et niveau vérifiés il y a plus
// de 6 heures.
// Appelé par la page après son affichage ; renvoie les fiches mises à jour.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || req.headers['x-premier'] !== '1') return res.status(405).json({ error: 'requête refusée' });
  if (!(await requireUser(req, res))) return;

  try {
    const snap = await items('joueurs').get();
    const stale = snap.docs.filter((doc) => {
      const p = doc.data();
      // Fiche sans bannière (enregistrée avant son ajout) : relue tout de suite.
      return p.riotId && (!('carte' in p) || !(Date.now() - Date.parse(p.rankCheckedAt || 0) < MAX_AGE_MS));
    });

    const updated = {};
    await Promise.all(
      stale.map(async (doc) => {
        const live = await fetchPlayer(doc.data().riotId);
        // Infos introuvables : on garde les anciennes, on retentera dans 6 heures.
        const patch = { rankCheckedAt: new Date().toISOString() };
        if (live?.rang) Object.assign(patch, { rang: live.rang, rangAuto: true });
        if (live?.carte) patch.carte = live.carte;
        if (live?.niveau != null) patch.niveau = live.niveau;
        await doc.ref.update(patch);
        updated[doc.id] = { ...doc.data(), ...patch };
      })
    );

    res.json({ joueurs: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'erreur serveur' });
  }
};
