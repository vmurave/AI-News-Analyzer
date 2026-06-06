'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/subscribers — only the COUNT is exposed. The actual email list is
// private (there is no auth), so we never return subscriber addresses.
router.get('/', async (req, res) => {
  try {
    const subs = await db.getSubscribers();
    res.json({ count: subs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subscribers — subscribe an email to the daily 8:00 digest.
router.post('/', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    const added = await db.addSubscriber(email);
    const subs = await db.getSubscribers();
    res.json({
      count: subs.length,
      added,
      message: added ? 'Subscribed to the daily digest.' : 'This email is already subscribed.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/subscribers/:email — unsubscribe an email (self-service: you must
// know the address). Returns only the updated count, never the list.
router.delete('/:email', async (req, res) => {
  try {
    const email = String(req.params.email || '').trim().toLowerCase();
    const removed = await db.removeSubscriber(email);
    const subs = await db.getSubscribers();
    if (!removed) return res.status(404).json({ error: 'That email is not subscribed.', count: subs.length });
    res.json({ count: subs.length, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
