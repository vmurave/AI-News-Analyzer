'use strict';

require('dotenv').config();

const createApp = require('./app');
const db = require('./db');
const { startScheduler } = require('./services/scheduler');

const app = createApp({ serveStatic: true });
const PORT = Number(process.env.PORT) || 3000;

// Warm up the database (schema/migrations/seed) so errors surface at boot.
db.ready().catch((err) => console.error('[db] initialization failed:', err.message));

// Fallback message when the client hasn't been built yet (dev convenience).
app.get('/', (req, res, next) => {
  const fs = require('fs');
  const path = require('path');
  if (fs.existsSync(path.join(__dirname, '..', 'client', 'dist', 'index.html'))) return next();
  res.type('text').send(
    'AI News Analyzer API is running.\n' +
      'The React client has not been built yet.\n' +
      'For development run "npm run dev" (Vite serves the client on :5173).\n' +
      'For production run "npm run build" then "npm start".'
  );
});

app.listen(PORT, () => {
  console.log(`\n🤖 AI News Analyzer server running at http://localhost:${PORT}`);
  console.log(`   API base:  http://localhost:${PORT}/api`);
  startScheduler();
});
