const crypto = require('crypto');
const { getSession } = require('../lib/session');
const { items } = require('../lib/firebase');

// GET    /api/data                          → { maps, compos, matchs }
// PUT    /api/data  { collection, id, data } → enregistre (id vide = nouveau match)
// DELETE /api/data?collection=matchs&id=…    → supprime un match

const text = (max) => (v) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (min, max) => (v) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
const mapId = (v) => (typeof v === 'string' && /^[a-z]{2,20}$/.test(v) ? v : null);

const SCHEMAS = {
  maps: { attaque: text(8000), defense: text(8000), retake: text(8000), notes: text(8000) },
  compos: {
    slots: (v) =>
      Array.from({ length: 5 }, (_, i) => ({
        agent: text(40)(v?.[i]?.agent),
        joueur: text(40)(v?.[i]?.joueur)
      })),
    notes: text(2000)
  },
  matchs: {
    date: (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''),
    map: (v) => mapId(v) || '',
    adversaire: text(60),
    scoreNous: int(0, 30),
    scoreEux: int(0, 30),
    debrief: text(8000)
  }
};

function clean(collection, data) {
  const out = {};
  for (const [field, check] of Object.entries(SCHEMAS[collection])) out[field] = check(data?.[field]);
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = getSession(req);
  if (!user) return res.status(401).json({ error: 'non connecté' });

  try {
    if (req.method === 'GET') {
      const result = {};
      for (const name of Object.keys(SCHEMAS)) {
        const snap = await items(name).get();
        result[name] = {};
        snap.forEach((doc) => (result[name][doc.id] = doc.data()));
      }
      return res.json(result);
    }

    // Les écritures exigent un en-tête que seul notre propre script envoie :
    // un formulaire piégé sur un autre site ne peut pas l'ajouter.
    if (req.headers['x-premier'] !== '1') return res.status(403).json({ error: 'requête refusée' });

    if (req.method === 'PUT') {
      const { collection, id, data } = req.body || {};
      if (!SCHEMAS[collection]) return res.status(400).json({ error: 'collection inconnue' });

      let docId = collection === 'matchs' ? id || crypto.randomUUID() : mapId(id);
      if (!docId || !/^[\w-]{1,40}$/.test(docId)) return res.status(400).json({ error: 'identifiant invalide' });

      const saved = { ...clean(collection, data), updatedBy: user.name, updatedAt: new Date().toISOString() };
      await items(collection).doc(docId).set(saved);
      return res.json({ id: docId, data: saved });
    }

    if (req.method === 'DELETE') {
      const { collection, id } = req.query;
      if (collection !== 'matchs' || !/^[\w-]{1,40}$/.test(id || '')) return res.status(400).json({ error: 'suppression impossible' });
      await items('matchs').doc(id).delete();
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'méthode non prise en charge' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'erreur serveur' });
  }
};
