'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

require('./db'); // initialize schema / seed settings on boot
const { startScheduler } = require('./services/scheduler');

const settingsRoutes = require('./routes/settings');
const newsRoutes = require('./routes/news');
const refreshRoutes = require('./routes/refresh');
const subscribersRoutes = require('./routes/subscribers');
const apiKeyRoutes = require('./routes/apikey');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---- API routes -----------------------------------------------------------
app.use('/api/settings', settingsRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/refresh', refreshRoutes);
app.use('/api/subscribers', subscribersRoutes);
app.use('/api/apikey', apiKeyRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
    geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
    timezone: process.env.DIGEST_TIMEZONE || 'UTC',
    digestCron: process.env.DIGEST_CRON || '0 8 * * *',
  });
});

// ---- Serve built React client in production (client/dist) -----------------
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback for client-side routing.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.type('text').send(
      'AI News Analyzer API is running.\n' +
        'The React client has not been built yet.\n' +
        'For development run "npm run dev" (Vite serves the client on :5173).\n' +
        'For production run "npm run build" then "npm start".'
    );
  });
}

// ---- Error handler --------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🤖 AI News Analyzer server running at http://localhost:${PORT}`);
  console.log(`   API base:  http://localhost:${PORT}/api`);
  startScheduler();
});
