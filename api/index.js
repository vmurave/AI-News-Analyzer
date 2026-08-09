'use strict';

// Vercel serverless entry. All /api/* requests are rewritten to this function
// (see vercel.json), and the exported Express app handles routing. Static
// assets are served by Vercel's CDN from client/dist. node-cron is NOT started
// here — the weekly digest runs via Vercel Cron hitting /api/cron/digest.
require('dotenv').config();

const createApp = require('../server/app');

module.exports = createApp();
