'use strict';

const express = require('express');
const { runDigestJob } = require('../services/scheduler');

const router = express.Router();

/**
 * GET/POST /api/cron/digest
 * Invoked by Vercel Cron (see vercel.json) to run the weekly digest in a
 * serverless environment where node-cron can't keep a process alive.
 * Protected by CRON_SECRET: Vercel sends "Authorization: Bearer <CRON_SECRET>".
 */
router.all('/digest', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.get('authorization') || '';
    const provided = auth.replace(/^Bearer\s+/i, '').trim() || req.query.secret;
    if (provided !== secret) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }
  try {
    const result = await runDigestJob({ force: true });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
