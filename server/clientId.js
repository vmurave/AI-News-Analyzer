'use strict';

// Read the anonymous per-browser client id from the X-Client-Id header.
// Returns a sanitized id, or '' when missing/invalid (treated as the shared
// default namespace). Keeping the charset/length tight avoids using arbitrary
// header values as SQL keys.
function getClientId(req) {
  const raw = String(req.get('x-client-id') || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : '';
}

module.exports = { getClientId };
