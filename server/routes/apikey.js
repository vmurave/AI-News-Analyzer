'use strict';

const express = require('express');
const db = require('../db');
const { getClientId } = require('../clientId');

const router = express.Router();

// GET /api/apikey — masked status for this browser's custom key (no plaintext).
router.get('/', (req, res) => {
  const clientId = getClientId(req);
  if (!clientId) return res.json({ hasKey: false, masked: '' });
  res.json(db.getClientApiKeyMeta(clientId));
});

// PUT /api/apikey — save/replace this browser's custom key.
router.put('/', (req, res) => {
  const clientId = getClientId(req);
  if (!clientId) {
    return res.status(400).json({ error: 'Missing client identifier. Please reload the page and try again.' });
  }
  const apiKey = String(req.body?.apiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ error: 'API key cannot be empty.' });
  }
  try {
    db.setClientApiKey(clientId, apiKey);
    // Respond with masked metadata only — never echo the key back.
    res.json({ ...db.getClientApiKeyMeta(clientId), message: 'Custom API key saved.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the API key.' });
  }
});

// DELETE /api/apikey — remove this browser's custom key.
router.delete('/', (req, res) => {
  const clientId = getClientId(req);
  if (!clientId) {
    return res.status(400).json({ error: 'Missing client identifier.' });
  }
  const removed = db.removeClientApiKey(clientId);
  res.json({ hasKey: false, masked: '', removed, message: removed ? 'Custom API key removed.' : 'No custom key was saved.' });
});

module.exports = router;
