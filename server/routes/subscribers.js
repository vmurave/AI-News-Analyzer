'use strict';

const express = require('express');
const db = require('../db');
const { sendSubscriptionNotice } = require('../services/mailer');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sanitize an incoming sources array to [{ name, url }].
function cleanSources(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string')
    .map((s) => ({ name: s.name.trim(), url: s.url.trim() }))
    .filter((s) => s.name && s.url)
    .slice(0, 20);
}

// The subscriber list AND its size are private (there is no auth). The API never
// returns subscriber addresses or a count.

// GET /api/subscribers — intentionally exposes nothing about subscribers.
router.get('/', (req, res) => {
  res.json({ ok: true });
});

// POST /api/subscribers — subscribe an email to the daily 8:00 digest.
router.post('/', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    const added = await db.addSubscriber(email);
    // Notify the digest admin with the subscriber's email + chosen sources.
    const notice = await sendSubscriptionNotice({
      email,
      sources: cleanSources(req.body?.sources),
      topic: String(req.body?.topic || '').trim(),
    });
    res.json({
      added,
      notified: notice.sent,
      message: added ? 'Subscribed to the daily digest.' : 'This email is already subscribed.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/subscribers/:email — unsubscribe an email (self-service: you must
// know the address). Never returns the list or a count.
router.delete('/:email', async (req, res) => {
  try {
    const email = String(req.params.email || '').trim().toLowerCase();
    const removed = await db.removeSubscriber(email);
    if (!removed) return res.status(404).json({ error: 'That email is not subscribed.' });
    res.json({ removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
