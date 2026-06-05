'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/subscribers — list current daily-digest subscribers.
router.get('/', (req, res) => {
  res.json({ subscribers: db.getSubscribers() });
});

// POST /api/subscribers — subscribe an email to the daily 8:00 digest.
router.post('/', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const added = db.addSubscriber(email);
  res.json({
    subscribers: db.getSubscribers(),
    added,
    message: added ? 'Subscribed to the daily digest.' : 'This email is already subscribed.',
  });
});

// DELETE /api/subscribers/:email — unsubscribe an email.
router.delete('/:email', (req, res) => {
  const email = String(req.params.email || '').trim().toLowerCase();
  const removed = db.removeSubscriber(email);
  if (!removed) return res.status(404).json({ error: 'That email is not subscribed.' });
  res.json({ subscribers: db.getSubscribers(), removed });
});

module.exports = router;
