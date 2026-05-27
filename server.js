const express = require('express');
const path = require('path');
const session = require('express-session');
const { PORT, SESSION_SECRET } = require('./config');
const { passport, requireAuth } = require('./auth');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 giorni
}));

app.use(passport.initialize());
app.use(passport.session());

// Pagine pubbliche (login, pending, ecc.)
const PUBLIC_PAGES = ['/login.html', '/pending.html'];
app.use((req, res, next) => {
  if (PUBLIC_PAGES.includes(req.path)) return next();
  if (req.path.startsWith('/auth/')) return next();
  if (req.path.startsWith('/api/')) return next(); // le API hanno il loro check
  requireAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// Routes pubbliche (auth)
app.use('/', require('./routes/auth'));

// Routes API protette
app.use('/api', requireAuth, require('./routes/generate'));
app.use('/api', requireAuth, require('./routes/generate-video'));
app.use('/api', requireAuth, require('./routes/gallery'));

app.listen(PORT, () => {
  console.log(`ComfyUI RunPod → http://localhost:${PORT}`);
});
