const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Database = require('better-sqlite3');
const path = require('path');
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL } = require('./config');

const db = new Database(path.join(__dirname, 'users.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    avatar TEXT,
    approved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function findOrCreateUser(profile) {
  const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
  if (existing) return existing;
  db.prepare(
    'INSERT INTO users (google_id, email, name, avatar) VALUES (?, ?, ?, ?)'
  ).run(
    profile.id,
    profile.emails[0].value,
    profile.displayName,
    profile.photos?.[0]?.value || null
  );
  return db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
}

function approveUser(email) {
  return db.prepare('UPDATE users SET approved = 1 WHERE email = ?').run(email);
}

function listUsers() {
  return db.prepare('SELECT id, email, name, approved, created_at FROM users ORDER BY created_at DESC').all();
}

passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: `${BASE_URL}/auth/callback`,
}, (accessToken, refreshToken, profile, done) => {
  try {
    const user = findOrCreateUser(profile);
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user || false);
});

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/login.html');
  if (!req.user.approved) return res.redirect('/pending.html');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated() || !req.user.approved) return res.status(403).json({ error: 'Forbidden' });
  // Admin = primo utente creato (id=1) o email specifica
  if (req.user.id !== 1) return res.status(403).json({ error: 'Forbidden' });
  next();
}

module.exports = { passport, requireAuth, requireAdmin, approveUser, listUsers, db };
