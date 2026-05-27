const express = require('express');
const passport = require('passport');
const { requireAdmin, approveUser, listUsers } = require('../auth');

const router = express.Router();

router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/auth/callback',
  passport.authenticate('google', { failureRedirect: '/login.html' }),
  (req, res) => {
    if (!req.user.approved) return res.redirect('/pending.html');
    res.redirect('/');
  }
);

router.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/login.html'));
});

router.get('/auth/me', (req, res) => {
  if (!req.isAuthenticated()) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    approved: !!req.user.approved,
    name: req.user.name,
    email: req.user.email,
    avatar: req.user.avatar,
  });
});

// Admin: lista utenti
router.get('/admin/users', requireAdmin, (req, res) => {
  res.json(listUsers());
});

// Admin: approva utente
router.post('/admin/approve', requireAdmin, (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email richiesta' });
  approveUser(email);
  res.json({ success: true });
});

module.exports = router;
