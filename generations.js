const { db } = require('./auth');

db.exec(`
  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    type TEXT DEFAULT 'video',
    prompt TEXT,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    framerate INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const insert = db.prepare(`
  INSERT INTO generations (user_id, filename, r2_key, type, prompt, width, height, duration, framerate)
  VALUES (@userId, @filename, @r2Key, @type, @prompt, @width, @height, @duration, @framerate)
`);

const listByUser = db.prepare(`
  SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC
`);

const findByFilename = db.prepare(`
  SELECT * FROM generations WHERE filename = ? AND user_id = ?
`);

const remove = db.prepare(`
  DELETE FROM generations WHERE filename = ? AND user_id = ?
`);

module.exports = { insert, listByUser, findByFilename, remove };
