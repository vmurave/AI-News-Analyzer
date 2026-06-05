'use strict';

const cron = require('node-cron');
const db = require('../db');
const { refreshNews } = require('./newsService');
const { sendDigest } = require('./mailer');

let task = null;

/**
 * Run the full digest pipeline once: refresh all sources, then email the digest.
 * Exposed so the /refresh route or a manual trigger can reuse it.
 */
async function runDigestJob({ force = true } = {}) {
  console.log(`[scheduler] Running daily digest job at ${new Date().toISOString()}`);
  try {
    const { items, report } = await refreshNews({ force });
    const settings = await db.getSettings();
    const recipients = await db.getSubscribers();
    const result = await sendDigest(items, report, settings, recipients);
    if (result.sent) {
      console.log(`[scheduler] Digest emailed to ${result.recipients} subscriber(s) (id: ${result.messageId})`);
    } else {
      console.warn(`[scheduler] Digest not sent: ${result.reason}`);
    }
    return result;
  } catch (err) {
    console.error('[scheduler] Digest job failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

/**
 * Schedule the daily digest. Cron expression and timezone come from .env
 * (DIGEST_CRON defaults to 08:00 daily; DIGEST_TIMEZONE defaults to UTC).
 */
function startScheduler() {
  const expression = process.env.DIGEST_CRON || '0 8 * * *';
  const timezone = process.env.DIGEST_TIMEZONE || 'UTC';

  if (!cron.validate(expression)) {
    console.error(`[scheduler] Invalid DIGEST_CRON "${expression}" — scheduler not started.`);
    return null;
  }

  if (task) task.stop();
  task = cron.schedule(expression, () => runDigestJob({ force: true }), { timezone });

  console.log(`[scheduler] Daily digest scheduled: "${expression}" (timezone: ${timezone})`);
  return task;
}

module.exports = { startScheduler, runDigestJob };
