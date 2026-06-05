'use strict';

const express = require('express');
const { refreshNews } = require('../services/newsService');
const { runDigestJob } = require('../services/scheduler');
const { sendDigest } = require('../services/mailer');
const db = require('../db');
const { latestTimestamp } = require('./news');
const { getClientId } = require('../clientId');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/refresh
 * Force a re-scrape + re-summarize of all sources, bypassing the 1h cache.
 */
router.post('/', async (req, res) => {
  try {
    const force = req.body?.force !== false; // default true
    const clientId = getClientId(req);
    const { items, report } = await refreshNews({ force, clientId });
    res.json({ items, report, lastUpdated: latestTimestamp(items) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/refresh/send-digest
 * Manually send the digest email now. Body may include an optional `email` to
 * send a one-off digest to that address WITHOUT subscribing it; otherwise the
 * digest goes to all current subscribers.
 */
router.post('/send-digest', async (req, res) => {
  try {
    const oneOff = String(req.body?.email || '').trim().toLowerCase();
    if (oneOff && !EMAIL_RE.test(oneOff)) {
      return res.status(400).json({ sent: false, reason: 'Please enter a valid email address.' });
    }
    const recipients = oneOff ? [oneOff] : await db.getSubscribers();
    if (recipients.length === 0) {
      return res.status(400).json({
        sent: false,
        reason: 'No recipients — enter an email above or add a subscriber first.',
      });
    }
    const { items, report } = await refreshNews({ force: false });
    const settings = await db.getSettings();
    const result = await sendDigest(items, report, settings, recipients);
    if (result.sent) return res.json(result);
    return res.status(400).json(result);
  } catch (err) {
    res.status(500).json({ sent: false, reason: err.message });
  }
});

/**
 * POST /api/refresh/run-digest-job
 * Run the full scheduled job (force refresh + email) on demand.
 */
router.post('/run-digest-job', async (req, res) => {
  const result = await runDigestJob({ force: true });
  res.json(result);
});

module.exports = router;
