'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { encrypt, decrypt } = require('./services/crypto');

// ---- Database location ----------------------------------------------------
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'ai-news-analyzer.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ---- Default news sources -------------------------------------------------
// RSS/Atom feeds — cleaner than scraping HTML and rarely bot-blocked.
const DEFAULT_SOURCES = [
  { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
  { name: 'Google AI', url: 'https://blog.google/technology/ai/rss/' },
  { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/' },
  { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/' },
  { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
];

const MAX_SOURCES = 7;

// ---- Schema ---------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    email         TEXT    DEFAULT '',
    topic_filter  TEXT    DEFAULT '',
    llm_provider  TEXT    DEFAULT 'gemini',  -- 'gemini' | 'custom'
    llm_api_key   TEXT    DEFAULT '',
    llm_model     TEXT    DEFAULT 'gemini-3.1-flash-lite',
    llm_endpoint  TEXT    DEFAULT '',
    sources       TEXT    DEFAULT '[]',      -- JSON array of { name, url }
    updated_at    TEXT    DEFAULT (datetime('now'))
  );

  -- Per-source analysis cache. Namespaced by client_id ('' = shared/default,
  -- generated with the shared key; a browser's anon id = that client's results).
  CREATE TABLE IF NOT EXISTS summaries (
    client_id          TEXT NOT NULL DEFAULT '',
    source_name        TEXT NOT NULL,
    source_url         TEXT,
    executive_summary  TEXT,    -- 2-3 sentence per-source summary (no links)
    themes             TEXT,    -- JSON array of { name, topicOverview, whyItMatters, link }
    articles           TEXT,    -- JSON array of { title, link }
    error              TEXT,    -- error message when scrape/summarize failed (nullable)
    updated_at         TEXT,    -- ISO timestamp
    PRIMARY KEY (client_id, source_name)
  );

  -- Cross-source analysis + rendered report, namespaced by client_id ('' = shared).
  CREATE TABLE IF NOT EXISTS reports (
    client_id          TEXT PRIMARY KEY DEFAULT '',
    executive_summary  TEXT,    -- 3-5 sentence cross-source summary (no links)
    themes             TEXT,    -- JSON array of { name, evidence[], whyItMatters }
    markdown           TEXT,    -- full assembled Markdown report
    updated_at         TEXT
  );

  -- Daily-digest subscribers (one row per email).
  CREATE TABLE IF NOT EXISTS subscribers (
    email       TEXT PRIMARY KEY,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- Per-browser custom API keys, encrypted at rest (never stored in plaintext).
  CREATE TABLE IF NOT EXISTS api_keys (
    client_id   TEXT PRIMARY KEY,
    key_enc     TEXT NOT NULL,   -- AES-256-GCM ciphertext of the user's API key
    last4       TEXT,            -- last 4 chars, for masked display only
    updated_at  TEXT
  );
`);

// ---- Migrations -----------------------------------------------------------
// summaries & reports are regenerable caches, so when their schema changes we
// drop & recreate rather than ALTERing column-by-column.
(function migrateCaches() {
  const sumCols = db.prepare("PRAGMA table_info('summaries')").all().map((c) => c.name);
  if (sumCols.length && (!sumCols.includes('themes') || !sumCols.includes('client_id'))) {
    db.exec('DROP TABLE summaries;');
    db.exec(`
      CREATE TABLE summaries (
        client_id          TEXT NOT NULL DEFAULT '',
        source_name        TEXT NOT NULL,
        source_url         TEXT,
        executive_summary  TEXT,
        themes             TEXT,
        articles           TEXT,
        error              TEXT,
        updated_at         TEXT,
        PRIMARY KEY (client_id, source_name)
      );
    `);
  }

  const repCols = db.prepare("PRAGMA table_info('reports')").all().map((c) => c.name);
  if (repCols.length && !repCols.includes('client_id')) {
    db.exec('DROP TABLE reports;');
    db.exec(`
      CREATE TABLE reports (
        client_id          TEXT PRIMARY KEY DEFAULT '',
        executive_summary  TEXT,
        themes             TEXT,
        markdown           TEXT,
        updated_at         TEXT
      );
    `);
  }
})();

// ---- Settings: seed a single row if missing -------------------------------
function seedSettings() {
  const row = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!row) {
    db.prepare(
      `INSERT INTO settings (id, email, topic_filter, llm_provider, llm_api_key, llm_model, llm_endpoint, sources)
       VALUES (1, '', '', 'gemini', '', 'gemini-3.1-flash-lite', '', @sources)`
    ).run({ sources: JSON.stringify(DEFAULT_SOURCES) });
  }
}
seedSettings();

function getSettings() {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  let sources;
  try {
    sources = JSON.parse(row.sources || '[]');
  } catch {
    sources = DEFAULT_SOURCES;
  }
  if (!Array.isArray(sources) || sources.length === 0) sources = DEFAULT_SOURCES;
  return {
    email: row.email || '',
    topicFilter: row.topic_filter || '',
    llmProvider: row.llm_provider || 'gemini',
    llmApiKey: row.llm_api_key || '',
    llmModel: row.llm_model || 'gemini-3.1-flash-lite',
    llmEndpoint: row.llm_endpoint || '',
    sources,
    updatedAt: row.updated_at,
  };
}

function sanitizeSources(input) {
  if (!Array.isArray(input)) return DEFAULT_SOURCES;
  const cleaned = input
    .filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string')
    .map((s) => ({ name: s.name.trim(), url: s.url.trim() }))
    .filter((s) => s.name && s.url)
    .slice(0, MAX_SOURCES);
  return cleaned.length ? cleaned : DEFAULT_SOURCES;
}

function updateSettings(patch = {}) {
  const current = getSettings();
  const next = {
    email: patch.email !== undefined ? String(patch.email).trim() : current.email,
    topic_filter: patch.topicFilter !== undefined ? String(patch.topicFilter).trim() : current.topicFilter,
    llm_provider: patch.llmProvider !== undefined ? String(patch.llmProvider) : current.llmProvider,
    llm_api_key: patch.llmApiKey !== undefined ? String(patch.llmApiKey) : current.llmApiKey,
    llm_model: patch.llmModel !== undefined ? String(patch.llmModel).trim() : current.llmModel,
    llm_endpoint: patch.llmEndpoint !== undefined ? String(patch.llmEndpoint).trim() : current.llmEndpoint,
    sources: patch.sources !== undefined ? JSON.stringify(sanitizeSources(patch.sources)) : JSON.stringify(current.sources),
  };
  db.prepare(
    `UPDATE settings SET
       email = @email,
       topic_filter = @topic_filter,
       llm_provider = @llm_provider,
       llm_api_key = @llm_api_key,
       llm_model = @llm_model,
       llm_endpoint = @llm_endpoint,
       sources = @sources,
       updated_at = datetime('now')
     WHERE id = 1`
  ).run(next);
  return getSettings();
}

// ---- Summaries cache ------------------------------------------------------
const safeParse = (v, fallback) => {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

function upsertSummary(summary, clientId = '') {
  db.prepare(
    `INSERT INTO summaries (client_id, source_name, source_url, executive_summary, themes, articles, error, updated_at)
     VALUES (@client_id, @source_name, @source_url, @executive_summary, @themes, @articles, @error, @updated_at)
     ON CONFLICT(client_id, source_name) DO UPDATE SET
       source_url        = excluded.source_url,
       executive_summary = excluded.executive_summary,
       themes            = excluded.themes,
       articles          = excluded.articles,
       error             = excluded.error,
       updated_at        = excluded.updated_at`
  ).run({
    client_id: clientId || '',
    source_name: summary.sourceName,
    source_url: summary.sourceUrl || '',
    executive_summary: summary.executiveSummary || '',
    themes: JSON.stringify(summary.themes || []),
    articles: JSON.stringify(summary.articles || []),
    error: summary.error || null,
    updated_at: summary.updatedAt || new Date().toISOString(),
  });
}

function rowToSummary(row) {
  if (!row) return null;
  return {
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    executiveSummary: row.executive_summary || '',
    themes: safeParse(row.themes, []),
    articles: safeParse(row.articles, []),
    error: row.error || null,
    updatedAt: row.updated_at,
  };
}

// ---- Cross-source report (per client; '' = shared) ------------------------
function saveCrossSourceReport(report, clientId = '') {
  db.prepare(
    `INSERT INTO reports (client_id, executive_summary, themes, markdown, updated_at)
     VALUES (@client_id, @executive_summary, @themes, @markdown, @updated_at)
     ON CONFLICT(client_id) DO UPDATE SET
       executive_summary = excluded.executive_summary,
       themes            = excluded.themes,
       markdown          = excluded.markdown,
       updated_at        = excluded.updated_at`
  ).run({
    client_id: clientId || '',
    executive_summary: report.executiveSummary || '',
    themes: JSON.stringify(report.themes || []),
    markdown: report.markdown || '',
    updated_at: report.updatedAt || new Date().toISOString(),
  });
}

function getCrossSourceReport(clientId = '') {
  const row = db.prepare('SELECT * FROM reports WHERE client_id = ?').get(clientId || '');
  if (!row) return { executiveSummary: '', themes: [], markdown: '', updatedAt: null };
  return {
    executiveSummary: row.executive_summary || '',
    themes: safeParse(row.themes, []),
    markdown: row.markdown || '',
    updatedAt: row.updated_at,
  };
}

function getSummary(sourceName, clientId = '') {
  return rowToSummary(
    db.prepare('SELECT * FROM summaries WHERE client_id = ? AND source_name = ?').get(clientId || '', sourceName)
  );
}

function getAllSummaries(clientId = '') {
  return db
    .prepare('SELECT * FROM summaries WHERE client_id = ? ORDER BY source_name')
    .all(clientId || '')
    .map(rowToSummary);
}

// Remove cached summaries (for one client namespace) that are no longer in the
// configured source list.
function pruneSummaries(validSourceNames, clientId = '') {
  const valid = new Set(validSourceNames);
  const all = db.prepare('SELECT source_name FROM summaries WHERE client_id = ?').all(clientId || '');
  const del = db.prepare('DELETE FROM summaries WHERE client_id = ? AND source_name = ?');
  for (const { source_name } of all) {
    if (!valid.has(source_name)) del.run(clientId || '', source_name);
  }
}

// ---- Digest subscribers ---------------------------------------------------
function getSubscribers() {
  return db
    .prepare('SELECT email FROM subscribers ORDER BY created_at')
    .all()
    .map((r) => r.email);
}

// Add a subscriber. Returns true if newly added, false if already subscribed.
function addSubscriber(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const info = db
    .prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)')
    .run(normalized);
  return info.changes > 0;
}

function removeSubscriber(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const info = db.prepare('DELETE FROM subscribers WHERE email = ?').run(normalized);
  return info.changes > 0;
}

// ---- Per-client custom API keys (encrypted at rest) -----------------------
// Store a user's API key, encrypted. Only the last 4 chars are kept in the
// clear (for masked display). Plaintext is never persisted.
function setClientApiKey(clientId, plaintextKey) {
  const id = String(clientId || '').trim();
  const key = String(plaintextKey || '').trim();
  if (!id || !key) throw new Error('Both a client id and an API key are required.');
  db.prepare(
    `INSERT INTO api_keys (client_id, key_enc, last4, updated_at)
     VALUES (@client_id, @key_enc, @last4, @updated_at)
     ON CONFLICT(client_id) DO UPDATE SET
       key_enc    = excluded.key_enc,
       last4      = excluded.last4,
       updated_at = excluded.updated_at`
  ).run({
    client_id: id,
    key_enc: encrypt(key),
    last4: key.slice(-4),
    updated_at: new Date().toISOString(),
  });
}

// Public metadata for the UI — never includes plaintext.
function getClientApiKeyMeta(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return { hasKey: false, masked: '' };
  const row = db.prepare('SELECT last4, updated_at FROM api_keys WHERE client_id = ?').get(id);
  if (!row) return { hasKey: false, masked: '' };
  return { hasKey: true, masked: '••••••••' + (row.last4 || ''), updatedAt: row.updated_at };
}

// Server-internal: decrypt the key for making API calls. Returns null if none.
function getClientApiKeyPlaintext(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return null;
  const row = db.prepare('SELECT key_enc FROM api_keys WHERE client_id = ?').get(id);
  if (!row) return null;
  return decrypt(row.key_enc);
}

function removeClientApiKey(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return false;
  const info = db.prepare('DELETE FROM api_keys WHERE client_id = ?').run(id);
  return info.changes > 0;
}

function isFresh(updatedAt, maxAgeMs = 60 * 60 * 1000) {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < maxAgeMs;
}

module.exports = {
  db,
  DEFAULT_SOURCES,
  MAX_SOURCES,
  getSettings,
  updateSettings,
  sanitizeSources,
  upsertSummary,
  getSummary,
  getAllSummaries,
  pruneSummaries,
  isFresh,
  saveCrossSourceReport,
  getCrossSourceReport,
  getSubscribers,
  addSubscriber,
  removeSubscriber,
  setClientApiKey,
  getClientApiKeyMeta,
  getClientApiKeyPlaintext,
  removeClientApiKey,
};
