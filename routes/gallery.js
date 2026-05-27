const express = require('express');
const fs = require('fs');
const path = require('path');
const { deleteObject, publicUrl } = require('../r2');

const router = express.Router();
const OUTPUTS_DIR = path.join(__dirname, '../public/outputs');
const META_FILE = path.join(OUTPUTS_DIR, 'history.json');

function readHistory() {
  if (!fs.existsSync(META_FILE)) return [];
  return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
}

function writeHistory(history) {
  fs.writeFileSync(META_FILE, JSON.stringify(history, null, 2));
}

router.get('/gallery', (req, res) => {
  const userId = req.user.id;
  const history = readHistory()
    .filter(i => i.userId === userId)
    .map(i => ({
      ...i,
      url: i.r2Key ? publicUrl(i.r2Key) : `/outputs/${i.filename}`,
    }));
  res.json(history);
});

router.delete('/gallery/:filename', async (req, res) => {
  const { filename } = req.params;
  const userId = req.user.id;

  const history = readHistory();
  const entry = history.find(i => i.filename === filename);

  if (!entry || entry.userId !== userId) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  // Cancella da R2 se presente
  if (entry.r2Key) {
    try { await deleteObject(entry.r2Key); } catch (_) {}
  }

  // Cancella file locale se ancora presente
  const filepath = path.join(OUTPUTS_DIR, filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

  writeHistory(history.filter(i => i.filename !== filename));
  res.json({ success: true });
});

module.exports = router;
