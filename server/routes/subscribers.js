'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/subscribers — list current daily-digest subscribers.
router.get('/', async (req, res) => {
  try {
    res.json({ subscribers: await db.getSubscribers() });
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
    res.json({
      subscribers: await db.getSubscribers(),
      added,
      message: added ? 'Subscribed to the daily digest.' : 'This email is already subscribed.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/subscribers/:email — unsubscribe an email.
router.delete('/:email', async (req, res) => {
  try {
    const email = String(req.params.email || '').trim().toLowerCase();
    const removed = await db.removeSubscriber(email);
    if (!removed) return res.status(404).json({ error: 'That email is not subscribed.' });
    res.json({ subscribers: await db.getSubscribers(), removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
