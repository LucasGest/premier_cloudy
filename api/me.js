const { getSession } = require('../lib/session');

module.exports = (req, res) => {
  const user = getSession(req);
  res.setHeader('Cache-Control', 'no-store');
  if (!user) return res.status(401).json({ error: 'non connecté' });
  res.json({ id: user.id, name: user.name, avatar: user.avatar });
};
