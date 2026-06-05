'use strict';

const express = require('express');
const db = require('../db');
const { getCachedNews, refreshNews } = require('../services/newsService');
const { getClientId } = require('../clientId');

const router = express.Router();

/**
 * GET /api/news
 * Returns cached summaries immediately. If nothing is cached yet (first load),
 * triggers a refresh so the dashboard is populated on first visit.
 */
router.get('/', async (req, res) => {
  try {
    const clientId = getClientId(req);
    const { items, report } = await getCachedNews(clientId);
    const anyData = items.some((i) => i.updatedAt);

    if (!anyData) {
      // Cold start — fetch, summarize & synthesize the report now.
      const fresh = await refreshNews({ force: false, clientId });
      return res.json({
        items: fresh.items,
        report: fresh.report,
        lastUpdated: latestTimestamp(fresh.items),
        cold: true,
      });
    }

    res.json({ items, report, lastUpdated: latestTimestamp(items), cold: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function latestTimestamp(items) {
  const times = items.map((i) => i.updatedAt).filter(Boolean).map((t) => new Date(t).getTime());
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

module.exports = router;
module.exports.latestTimestamp = latestTimestamp;
