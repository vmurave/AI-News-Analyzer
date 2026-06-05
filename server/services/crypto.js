'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ---- Master encryption key ------------------------------------------------
// Used to encrypt user-supplied API keys at rest (AES-256-GCM).
// Resolution order:
//   1. API_KEY_SECRET env var (base64 or hex, 32 bytes) — recommended for prod.
//   2. A persisted random key in data/.keystore (auto-generated on first run).
// The plaintext key never leaves the server; this only protects the DB at rest.
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const KEYSTORE_PATH = path.join(DATA_DIR, '.keystore');

function parseEnvSecret(raw) {
  const tryBuf = (b) => (b.length === 32 ? b : null);
  // Accept base64 or hex.
  try {
    const b64 = tryBuf(Buffer.from(raw, 'base64'));
    if (b64) return b64;
  } catch {
    /* ignore */
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return null;
}

function loadOrCreateKey() {
  const envSecret = process.env.API_KEY_SECRET;
  if (envSecret) {
    const buf = parseEnvSecret(envSecret.trim());
    if (buf) return buf;
    console.warn(
      '[crypto] API_KEY_SECRET is set but is not a valid 32-byte base64/hex value; falling back to the persisted keystore.'
    );
  }

  try {
    if (fs.existsSync(KEYSTORE_PATH)) {
      const buf = Buffer.from(fs.readFileSync(KEYSTORE_PATH, 'utf8').trim(), 'base64');
      if (buf.length === 32) return buf;
    }
  } catch {
    /* fall through to regenerate */
  }

  // Generate and persist a fresh key (data/ is git-ignored).
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEYSTORE_PATH, key.toString('base64'), { mode: 0o600 });
  try {
    fs.chmodSync(KEYSTORE_PATH, 0o600);
  } catch {
    /* chmod is best-effort on Windows */
  }
  console.log('[crypto] Generated a new encryption key at data/.keystore (set API_KEY_SECRET to override).');
  return key;
}

const MASTER_KEY = loadOrCreateKey();

// ---- AES-256-GCM ----------------------------------------------------------
// Stored format: base64(iv).base64(authTag).base64(ciphertext)
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

function decrypt(payload) {
  try {
    const [ivB64, tagB64, dataB64] = String(payload).split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    // Tampered/undecryptable payload (e.g. keystore changed) — treat as no key.
    return null;
  }
}

// Last 4 chars for masked display, e.g. "••••••••1234".
function maskKey(plaintext) {
  const s = String(plaintext || '');
  if (s.length <= 4) return '••••••••';
  return '••••••••' + s.slice(-4);
}

module.exports = { encrypt, decrypt, maskKey };
