const { requireUser } = require('../lib/access');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res);
  if (!user) return;
  res.json({ id: user.id, name: user.name, avatar: user.avatar, igl: user.igl, admin: user.admin });
};
