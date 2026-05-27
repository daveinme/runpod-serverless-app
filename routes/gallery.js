const express = require('express');
const fs = require('fs');
const path = require('path');

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
  const history = readHistory().filter(i => i.userId === userId);
  res.json(history);
});

router.delete('/gallery/:filename', (req, res) => {
  const { filename } = req.params;
  const userId = req.user.id;

  const history = readHistory();
  const entry = history.find(i => i.filename === filename);

  // Sicurezza: solo il proprietario può cancellare
  if (!entry || entry.userId !== userId) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  const filepath = path.join(OUTPUTS_DIR, filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

  writeHistory(history.filter(i => i.filename !== filename));
  res.json({ success: true });
});

module.exports = router;
