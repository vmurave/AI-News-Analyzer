'use strict';

const express = require('express');
const db = require('../db');
const { sendSubscriptionNotice, sendDigest } = require('../services/mailer');
const { getCachedNews } = require('../services/newsService');

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

    // For a brand-new subscriber, send a welcome digest immediately using ONLY
    // the existing cached summaries (no scrape, no LLM calls — always fast), in
    // addition to the normal 8:00 AM schedule. Existing subscribers don't get a
    // resend. If nothing is cached yet, we skip the welcome email.
    let welcome = { sent: false, reason: 'Existing subscriber — no welcome digest sent.' };
    if (added) {
      try {
        const { items, report, settings } = await getCachedNews();
        const hasContent =
          items.some((i) => i.updatedAt || (i.themes && i.themes.length)) ||
          Boolean(report && (report.markdown || (report.themes && report.themes.length)));
        if (!hasContent) {
          welcome = {
            sent: false,
            reason: 'No digest is cached yet — your first one will arrive at 8:00 AM.',
          };
        } else {
          welcome = await sendDigest(items, report, settings, [email]);
        }
      } catch (err) {
        welcome = { sent: false, reason: err.message };
      }
    }

    let message;
    if (added) {
      message = welcome.sent
        ? 'Subscribed to the daily digest — a welcome digest is on its way to your inbox.'
        : `Subscribed to the daily digest. (Welcome digest not sent: ${welcome.reason})`;
    } else {
      message = 'This email is already subscribed.';
    }

    res.json({
      added,
      notified: notice.sent,
      welcomeSent: welcome.sent,
      welcomeReason: welcome.sent ? null : welcome.reason,
      message,
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
