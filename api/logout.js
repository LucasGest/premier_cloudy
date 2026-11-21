const { clearSession } = require('../lib/session');

// POST seulement, avec l'en-tête du site : un lien ou une image piégée sur un
// autre site ne peut pas déconnecter un joueur.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || req.headers['x-premier'] !== '1') return res.status(405).json({ error: 'requête refusée' });
  clearSession(res);
  res.json({ ok: true });
};
