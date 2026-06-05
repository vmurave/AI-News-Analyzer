'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const settingsRoutes = require('./routes/settings');
const newsRoutes = require('./routes/news');
const refreshRoutes = require('./routes/refresh');
const subscribersRoutes = require('./routes/subscribers');
const apiKeyRoutes = require('./routes/apikey');
const cronRoutes = require('./routes/cron');

/**
 * Build the Express app. Shared by the local server (server/index.js) and the
 * Vercel serverless entry (api/index.js).
 * @param {object} opts
 * @param {boolean} opts.serveStatic  Serve the built client from client/dist
 *   (used locally in production mode; on Vercel the CDN serves static assets).
 */
function createApp({ serveStatic = false } = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // ---- API routes ----------------------------------------------------------
  app.use('/api/settings', settingsRoutes);
  app.use('/api/news', newsRoutes);
  app.use('/api/refresh', refreshRoutes);
  app.use('/api/subscribers', subscribersRoutes);
  app.use('/api/apikey', apiKeyRoutes);
  app.use('/api/cron', cronRoutes);

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
      geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
      timezone: process.env.DIGEST_TIMEZONE || 'UTC',
      digestCron: process.env.DIGEST_CRON || '0 8 * * *',
    });
  });

  // ---- Serve built React client (local production only) --------------------
  if (serveStatic) {
    const clientDist = path.join(__dirname, '..', 'client', 'dist');
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(clientDist, 'index.html'));
      });
    }
  }

  // ---- Error handler -------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = createApp;
