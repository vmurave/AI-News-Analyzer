'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/settings — current settings (API key is masked).
router.get('/', async (req, res) => {
  try {
    const s = await db.getSettings();
    res.json({
      ...s,
      llmApiKey: s.llmApiKey ? '••••••••' : '',
      hasLlmApiKey: Boolean(s.llmApiKey),
      maxSources: db.MAX_SOURCES,
      defaultSources: db.DEFAULT_SOURCES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings — update settings. A masked/empty api key is ignored
// so the user doesn't accidentally wipe a saved key by re-saving the form.
router.put('/', async (req, res) => {
  try {
    const body = req.body || {};
    const patch = {
      email: body.email,
      topicFilter: body.topicFilter,
      llmProvider: body.llmProvider,
      llmModel: body.llmModel,
      llmEndpoint: body.llmEndpoint,
      sources: body.sources,
    };

    // Only update the key if the user typed a real (non-masked) value.
    if (typeof body.llmApiKey === 'string' && body.llmApiKey && !/^•+$/.test(body.llmApiKey)) {
      patch.llmApiKey = body.llmApiKey;
    }

    if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (patch.sources && Array.isArray(patch.sources) && patch.sources.length > db.MAX_SOURCES) {
      return res.status(400).json({ error: `A maximum of ${db.MAX_SOURCES} sources is allowed.` });
    }

    const updated = await db.updateSettings(patch);
    res.json({
      ...updated,
      llmApiKey: updated.llmApiKey ? '••••••••' : '',
      hasLlmApiKey: Boolean(updated.llmApiKey),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/reset-sources — restore default source list.
router.post('/reset-sources', async (req, res) => {
  try {
    const updated = await db.updateSettings({ sources: db.DEFAULT_SOURCES });
    res.json({ sources: updated.sources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
