const { requireUser } = require('../lib/access');
const { items, db } = require('../lib/firebase');
const { fetchTeamMatches } = require('../lib/matches');
const { postResult } = require('../lib/discord');

// POST /api/import : importe les matchs Premier de l'équipe depuis HenrikDev.
// Appelé à l'ouverture du site (au plus toutes les 30 minutes, tous joueurs
// confondus) ; l'administrateur peut forcer l'import avec { force: true }.
// Le score et les stats viennent du jeu ; le debrief écrit à la main est gardé.
const MIN_INTERVAL_MS = 30 * 60 * 1000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || req.headers['x-premier'] !== '1') return res.status(405).json({ error: 'requête refusée' });
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const meta = db().collection('premierStrats').doc('meta');
    const force = req.body?.force === true;
    if (force && !user.admin) return res.status(403).json({ error: 'réservé' });

    // Réserve le créneau d'import dans une transaction : deux ouvertures
    // simultanées du site ne lancent pas deux imports.
    const go = await db().runTransaction(async (tx) => {
      const last = (await tx.get(meta)).data()?.lastImport;
      if (!force && last && Date.now() - Date.parse(last) < MIN_INTERVAL_MS) return false;
      tx.set(meta, { lastImport: new Date().toISOString() }, { merge: true });
      return true;
    });
    if (!go) return res.json({ skipped: true, matchs: {} });

    const joueurs = {};
    (await items('joueurs').get()).forEach((doc) => (joueurs[doc.id] = doc.data()));
    const found = await fetchTeamMatches(joueurs);

    const result = {};
    let added = 0;
    const batch = db().batch();
    for (const { id, data } of found) {
      const ref = items('matchs').doc(id);
      const prev = (await ref.get()).data();
      const merged = { ...prev, ...data };
      if (!prev) {
        added += 1;
        Object.assign(merged, { debrief: '', updatedBy: 'Import auto', updatedAt: new Date().toISOString() });
      }
      batch.set(ref, merged);
      result[id] = merged;
    }
    if (found.length) await batch.commit();

    // Résultat posté sur Discord pour chaque nouveau match récent (moins de
    // 3 jours) : un premier import d'historique ne déclenche pas de rafale.
    const recent = (d) => Date.now() - Date.parse(`${d}T12:00:00Z`) < 3 * 24 * 3600 * 1000;
    for (const { id, data } of found) {
      if (!result[id].postedAt && recent(data.date)) {
        if (await postResult(result[id]).catch(() => false)) await items('matchs').doc(id).update({ postedAt: new Date().toISOString() });
      }
    }

    res.json({ matchs: result, added, total: found.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'erreur serveur' });
  }
};
