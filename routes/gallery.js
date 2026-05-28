const express = require('express');
const { deleteObject, publicUrl } = require('../r2');
const { listByUser, findByFilename, remove } = require('../generations');

const router = express.Router();

router.get('/gallery', (req, res) => {
  const userId = req.user.id;
  const items = listByUser.all(userId).map(i => ({
    ...i,
    url: publicUrl(i.r2_key),
  }));
  res.json(items);
});

router.delete('/gallery/:filename', async (req, res) => {
  const { filename } = req.params;
  const userId = req.user.id;

  const entry = findByFilename.get(filename, userId);
  if (!entry) return res.status(403).json({ error: 'Non autorizzato' });

  if (entry.r2_key) {
    try { await deleteObject(entry.r2_key); } catch (_) {}
  }

  remove.run(filename, userId);
  res.json({ success: true });
});

module.exports = router;
