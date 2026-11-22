const crypto = require('crypto');
const { requireUser } = require('../lib/access');
const { items, db } = require('../lib/firebase');
const { fetchPlayer } = require('../lib/rank');
const { postStrat, postTraining } = require('../lib/discord');
const { FieldValue } = require('firebase-admin/firestore');

// GET    /api/data                          → { joueurs, reglages, maps, strats, compos, matchs, dispos }
// PUT    /api/data  { collection, id, data } → enregistre (id vide = nouvelle strat ou nouveau
//                                              match ; pour joueurs, toujours sa propre fiche)
// PUT    /api/data  { collection: 'presence', id, data: { statut } } → sa présence à une séance
// DELETE /api/data?collection=strats|matchs|entrainements&id=… → supprime

const ROLES = ['Duelliste', 'Initiateur', 'Contrôleur', 'Sentinelle', 'Flex'];
const STATUTS = ['Titulaire', 'Remplaçant', 'Coach'];
const RANKS = /^(Fer|Bronze|Argent|Or|Platine|Diamant|Ascendant|Immortel) [1-3]$|^Radiant$/;
const COTES = ['attaque', 'defense', 'retake'];
const SITES = ['A', 'B', 'C', 'Mid'];
const TYPES_SEANCE = ['Strats', 'Scrim', 'Aim', 'Review VOD', 'Custom', 'Autre'];
const PRESENCES = ['oui', 'non'];
const oneOf = (list) => (v) => (list.includes(v) ? v : '');
const agents = (v) => (Array.isArray(v) ? v.filter((a) => typeof a === 'string' && /^[\w/ ]{2,20}$/.test(a)).slice(0, 5) : []);

const text = (max) => (v) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (min, max) => (v) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
const mapId = (v) => (typeof v === 'string' && /^[a-z]{2,20}$/.test(v) ? v : null);

// Tableau tactique d'une strat : des étapes, chacune une liste d'éléments posés
// sur la minimap. Coordonnées entières de 0 à 1000. Tout est revalidé ici :
// type connu, nombres bornés, textes tronqués, quantités plafonnées.
const coord = (v) => Math.min(1000, Math.max(0, Math.round(Number(v) || 0)));
const agentName = (v) => (typeof v === 'string' && /^[\w/ ]{2,20}$/.test(v) ? v : null);
const color = (v) => Math.min(5, Math.max(0, Math.round(Number(v) || 0)));
const ITEM = {
  a: (it) => agentName(it.a) && { t: 'a', a: it.a, s: it.s === 'def' ? 'def' : 'att', x: coord(it.x), y: coord(it.y) },
  u: (it) => agentName(it.a) && { t: 'u', a: it.a, i: Math.min(3, Math.max(0, Math.round(Number(it.i) || 0))), x: coord(it.x), y: coord(it.y) },
  l: (it) => {
    const p = Array.isArray(it.p) ? it.p.slice(0, 160).map(coord) : [];
    return p.length >= 4 && { t: 'l', c: color(it.c), f: it.f !== false, p: p.slice(0, p.length - (p.length % 2)) };
  },
  z: (it) => ({ t: 'z', c: color(it.c), x: coord(it.x), y: coord(it.y), r: Math.min(300, Math.max(10, Math.round(Number(it.r) || 40))) }),
  x: (it) => typeof it.txt === 'string' && it.txt.trim() && { t: 'x', c: color(it.c), x: coord(it.x), y: coord(it.y), txt: it.txt.trim().slice(0, 40) }
};
function tableau(v) {
  const phases = Array.isArray(v?.phases) ? v.phases.slice(0, 8) : [];
  return {
    phases: phases.map((ph, i) => ({
      nom: typeof ph?.nom === 'string' && ph.nom.trim() ? ph.nom.trim().slice(0, 30) : `Étape ${i + 1}`,
      items: (Array.isArray(ph?.items) ? ph.items : [])
        .slice(0, 120)
        .map((it) => ITEM[it?.t]?.(it))
        .filter(Boolean)
    }))
  };
}

const SCHEMAS = {
  joueurs: {
    riotId: (v) => (typeof v === 'string' && /^[^#]{3,16}#[A-Za-z0-9]{2,5}$/.test(v.trim()) ? v.trim() : ''),
    rang: (v) => (typeof v === 'string' && RANKS.test(v) ? v : ''),
    role: oneOf(ROLES),
    agents,
    statut: oneOf(STATUTS),
    notes: text(300)
  },
  // Réglages de l'équipe (un seul document, "site") : la map de la semaine.
  reglages: { mapSemaine: (v) => mapId(v) || '' },
  // Une fiche par map : les notes générales. Les strats sont à part, une par document.
  maps: { notes: text(8000) },
  strats: {
    map: (v) => mapId(v) || '',
    nom: (v) => text(60)(v).trim(),
    cote: oneOf(COTES),
    site: oneOf(SITES),
    agents,
    plan: text(6000),
    tableau
  },
  compos: {
    slots: (v) =>
      Array.from({ length: 5 }, (_, i) => ({
        agent: text(40)(v?.[i]?.agent),
        joueur: text(40)(v?.[i]?.joueur)
      })),
    notes: text(2000)
  },
  // Séances d'entraînement planifiées par l'IGL. Les présences sont à part
  // (champ presences, écrit par chaque joueur pour lui-même).
  entrainements: {
    date: (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''),
    heure: (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : ''),
    duree: int(15, 480),
    type: oneOf(TYPES_SEANCE),
    notes: text(1000)
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

// Garde-fous contre l'abus : taille d'une écriture, et 40 écritures par
// minute et par joueur (compté par instance de fonction, suffisant ici).
const MAX_BODY = 80000; // un tableau tactique complet tient largement dedans
const WRITES_PER_MIN = 40;
const writes = new Map();
function tooManyWrites(userId) {
  const now = Date.now();
  const recent = (writes.get(userId) || []).filter((t) => now - t < 60000);
  recent.push(now);
  writes.set(userId, recent);
  return recent.length > WRITES_PER_MIN;
}

// Qui peut écrire quoi. Les autres lisent seulement.
// joueurs : chacun sa fiche ; maps (notes générales) : toute l'équipe.
const CAN_WRITE = {
  joueurs: () => true,
  maps: () => true,
  reglages: (u) => u.igl,
  strats: (u) => u.igl,
  compos: (u) => u.igl,
  entrainements: (u) => u.igl,
  matchs: (u) => u.admin
};
// Collections où chaque document a un identifiant généré (une entrée par ajout).
const LISTS = ['strats', 'matchs', 'entrainements'];

// Champs sans lesquels un document n'a pas de sens.
const REQUIRED = { strats: ['map', 'nom', 'cote'], matchs: ['date', 'map'], entrainements: ['date', 'heure', 'type'] };

function clean(collection, data) {
  const out = {};
  for (const [field, check] of Object.entries(SCHEMAS[collection])) out[field] = check(data?.[field]);
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const result = {};
      for (const name of Object.keys(SCHEMAS)) {
        const snap = await items(name).get();
        result[name] = {};
        snap.forEach((doc) => (result[name][doc.id] = doc.data()));
      }
      // Dernier sondage /dispos lancé par le bot sur Discord.
      const poll = await db().collection('premierDispos').orderBy('createdAt', 'desc').limit(1).get();
      const last = poll.docs[0]?.data();
      result.dispos = last ? { monday: last.monday, responses: last.responses || {} } : null;
      return res.json(result);
    }

    // Les écritures exigent un en-tête que seul notre propre script envoie :
    // un formulaire piégé sur un autre site ne peut pas l'ajouter.
    if (req.headers['x-premier'] !== '1') return res.status(403).json({ error: 'requête refusée' });
    if (tooManyWrites(user.id)) return res.status(429).json({ error: 'trop de modifications, patientez une minute' });

    if (req.method === 'PUT') {
      if (!req.headers['content-type']?.startsWith('application/json') || JSON.stringify(req.body || {}).length > MAX_BODY) {
        return res.status(413).json({ error: 'requête trop volumineuse' });
      }
      const { collection, id, data } = req.body || {};

      // Présence à une séance : chaque joueur ne touche que sa propre réponse.
      if (collection === 'presence') {
        if (!/^[\w-]{1,40}$/.test(id || '')) return res.status(400).json({ error: 'identifiant invalide' });
        const ref = items('entrainements').doc(id);
        if (!(await ref.get()).exists) return res.status(404).json({ error: 'séance introuvable' });
        const statut = PRESENCES.includes(data?.statut) ? data.statut : null;
        await ref.update(`presences.${user.id}`, statut ? { statut, nom: user.name } : FieldValue.delete());
        return res.json({ id, data: (await ref.get()).data() });
      }

      if (!SCHEMAS[collection]) return res.status(400).json({ error: 'collection inconnue' });
      if (!CAN_WRITE[collection](user)) return res.status(403).json({ error: 'réservé' });

      // Chacun ne modifie que sa propre fiche joueur, quel que soit l'id envoyé.
      const docId =
        collection === 'joueurs'
          ? user.id
          : collection === 'reglages'
            ? 'site'
            : LISTS.includes(collection)
              ? id || crypto.randomUUID()
              : mapId(id);
      if (!docId || !/^[\w-]{1,40}$/.test(docId)) return res.status(400).json({ error: 'identifiant invalide' });

      const saved = { ...clean(collection, data), updatedBy: user.name, updatedAt: new Date().toISOString() };
      const missing = (REQUIRED[collection] || []).filter((field) => !saved[field]);
      if (missing.length) return res.status(400).json({ error: `champs manquants : ${missing.join(', ')}` });
      if (collection === 'joueurs') {
        // Rang lu en jeu quand le Riot ID est trouvé ; sinon celui choisi à la main.
        const live = saved.riotId ? await fetchPlayer(saved.riotId) : null;
        Object.assign(saved, {
          rang: live?.rang || saved.rang,
          rangAuto: Boolean(live?.rang),
          carte: live?.carte || null,
          niveau: live?.niveau ?? null,
          puuid: live?.puuid || null,
          rankCheckedAt: new Date().toISOString(),
          discord: user.name,
          avatar: user.avatar
        });
      }
      const ref = items(collection).doc(docId);
      if (collection === 'entrainements') {
        // Fusion : modifier une séance garde les présences déjà données.
        const isNew = !(await ref.get()).exists;
        await ref.set(saved, { merge: true });
        if (isNew) await postTraining(saved).catch(() => false);
        return res.json({ id: docId, data: (await ref.get()).data() });
      }
      if (collection === 'matchs') {
        // Fusion : un match importé garde ses stats de jeu quand on écrit son debrief.
        await ref.set(saved, { merge: true });
        return res.json({ id: docId, data: (await ref.get()).data() });
      }
      if (collection === 'strats') {
        // Annonce sur Discord à la création, puis au plus une fois par
        // demi-heure par strat, pour ne pas spammer pendant qu'on dessine.
        const before = await ref.get();
        const isNew = !before.exists;
        const last = Date.parse(before.data()?.notifiedAt || '') || 0;
        saved.notifiedAt = before.data()?.notifiedAt || null;
        if (isNew || Date.now() - last > 30 * 60 * 1000) {
          const ok = await postStrat(saved, isNew).catch(() => false);
          if (ok) saved.notifiedAt = new Date().toISOString();
        }
      }
      await ref.set(saved);
      return res.json({ id: docId, data: saved });
    }

    if (req.method === 'DELETE') {
      const { collection, id } = req.query;
      if (!LISTS.includes(collection) ||!/^[\w-]{1,40}$/.test(id || '')) return res.status(400).json({ error: 'suppression impossible' });
      if (!CAN_WRITE[collection](user)) return res.status(403).json({ error: 'réservé' });
      await items(collection).doc(id).delete();
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'méthode non prise en charge' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'erreur serveur' });
  }
};
