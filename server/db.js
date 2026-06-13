'use strict';

const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');
const { encrypt, decrypt } = require('./services/crypto');

// ---- Database connection --------------------------------------------------
// Cloud (Vercel/prod): set DATABASE_URL (libsql://… from Turso) + DATABASE_AUTH_TOKEN.
// Local/dev: defaults to a file-backed libSQL database under data/ (git-ignored),
// so no external service is needed to run locally.
const DATA_DIR = path.join(__dirname, '..', 'data');

function resolveDbConfig() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (url) {
    return { url, authToken: (process.env.DATABASE_AUTH_TOKEN || '').trim() || undefined };
  }
  // Local file fallback.
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return { url: `file:${path.join(DATA_DIR, 'ai-news-analyzer.db')}` };
}

const client = createClient(resolveDbConfig());

// ---- Defaults -------------------------------------------------------------
const DEFAULT_SOURCES = [
  { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
  { name: 'Google AI', url: 'https://blog.google/technology/ai/rss/' },
  { name: 'VentureBeat AI', url: 'https://venturebeat.com/feed/' },
  { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/' },
  { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { name: 'Anthropic News', url: 'https://www.anthropic.com/news' },
];
const MAX_SOURCES = 7;

// ---- Lazy, once-per-instance initialization -------------------------------
// Schema + migrations + seed run exactly once and every public function awaits
// readiness — which also covers serverless cold starts.
let readyPromise = null;
function ready() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function init() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS settings (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      email         TEXT    DEFAULT '',
      topic_filter  TEXT    DEFAULT '',
      llm_provider  TEXT    DEFAULT 'gemini',
      llm_api_key   TEXT    DEFAULT '',
      llm_model     TEXT    DEFAULT 'gemini-3.1-flash-lite',
      llm_endpoint  TEXT    DEFAULT '',
      sources       TEXT    DEFAULT '[]',
      updated_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS summaries (
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

    CREATE TABLE IF NOT EXISTS reports (
      client_id          TEXT PRIMARY KEY DEFAULT '',
      executive_summary  TEXT,
      themes             TEXT,
      markdown           TEXT,
      updated_at         TEXT
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      email       TEXT PRIMARY KEY,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      client_id   TEXT PRIMARY KEY,
      key_enc     TEXT NOT NULL,
      last4       TEXT,
      updated_at  TEXT
    );
  `);

  await migrateCaches();
  await seedSettings();
}

// summaries & reports are regenerable caches: drop & recreate on schema change.
async function migrateCaches() {
  const sumCols = (await client.execute("PRAGMA table_info('summaries')")).rows.map((c) => c.name);
  if (sumCols.length && (!sumCols.includes('themes') || !sumCols.includes('client_id'))) {
    await client.executeMultiple(`
      DROP TABLE summaries;
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

  const repCols = (await client.execute("PRAGMA table_info('reports')")).rows.map((c) => c.name);
  if (repCols.length && !repCols.includes('client_id')) {
    await client.executeMultiple(`
      DROP TABLE reports;
      CREATE TABLE reports (
        client_id          TEXT PRIMARY KEY DEFAULT '',
        executive_summary  TEXT,
        themes             TEXT,
        markdown           TEXT,
        updated_at         TEXT
      );
    `);
  }
}

async function seedSettings() {
  const row = (await client.execute('SELECT id FROM settings WHERE id = 1')).rows[0];
  if (!row) {
    await client.execute({
      sql: `INSERT INTO settings (id, email, topic_filter, llm_provider, llm_api_key, llm_model, llm_endpoint, sources)
            VALUES (1, '', '', 'gemini', '', 'gemini-3.1-flash-lite', '', ?)`,
      args: [JSON.stringify(DEFAULT_SOURCES)],
    });
  }
}

// ---- helpers --------------------------------------------------------------
const safeParse = (v, fallback) => {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

// ---- Settings -------------------------------------------------------------
async function getSettings() {
  await ready();
  const row = (await client.execute('SELECT * FROM settings WHERE id = 1')).rows[0];
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

async function updateSettings(patch = {}) {
  await ready();
  const current = await getSettings();
  const next = {
    email: patch.email !== undefined ? String(patch.email).trim() : current.email,
    topic_filter: patch.topicFilter !== undefined ? String(patch.topicFilter).trim() : current.topicFilter,
    llm_provider: patch.llmProvider !== undefined ? String(patch.llmProvider) : current.llmProvider,
    llm_api_key: patch.llmApiKey !== undefined ? String(patch.llmApiKey) : current.llmApiKey,
    llm_model: patch.llmModel !== undefined ? String(patch.llmModel).trim() : current.llmModel,
    llm_endpoint: patch.llmEndpoint !== undefined ? String(patch.llmEndpoint).trim() : current.llmEndpoint,
    sources: patch.sources !== undefined ? JSON.stringify(sanitizeSources(patch.sources)) : JSON.stringify(current.sources),
  };
  await client.execute({
    sql: `UPDATE settings SET email=?, topic_filter=?, llm_provider=?, llm_api_key=?, llm_model=?, llm_endpoint=?, sources=?, updated_at=datetime('now') WHERE id = 1`,
    args: [next.email, next.topic_filter, next.llm_provider, next.llm_api_key, next.llm_model, next.llm_endpoint, next.sources],
  });
  return getSettings();
}

// ---- Summaries cache (namespaced by client_id; '' = shared) ---------------
async function upsertSummary(summary, clientId = '') {
  await ready();
  await client.execute({
    sql: `INSERT INTO summaries (client_id, source_name, source_url, executive_summary, themes, articles, error, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(client_id, source_name) DO UPDATE SET
            source_url=excluded.source_url, executive_summary=excluded.executive_summary,
            themes=excluded.themes, articles=excluded.articles, error=excluded.error,
            updated_at=excluded.updated_at`,
    args: [
      clientId || '',
      summary.sourceName,
      summary.sourceUrl || '',
      summary.executiveSummary || '',
      JSON.stringify(summary.themes || []),
      JSON.stringify(summary.articles || []),
      summary.error || null,
      summary.updatedAt || new Date().toISOString(),
    ],
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

async function getSummary(sourceName, clientId = '') {
  await ready();
  const row = (
    await client.execute({
      sql: 'SELECT * FROM summaries WHERE client_id = ? AND source_name = ?',
      args: [clientId || '', sourceName],
    })
  ).rows[0];
  return rowToSummary(row);
}

async function getAllSummaries(clientId = '') {
  await ready();
  const res = await client.execute({
    sql: 'SELECT * FROM summaries WHERE client_id = ? ORDER BY source_name',
    args: [clientId || ''],
  });
  return res.rows.map(rowToSummary);
}

async function pruneSummaries(validSourceNames, clientId = '') {
  await ready();
  const valid = new Set(validSourceNames);
  const res = await client.execute({
    sql: 'SELECT source_name FROM summaries WHERE client_id = ?',
    args: [clientId || ''],
  });
  for (const { source_name } of res.rows) {
    if (!valid.has(source_name)) {
      await client.execute({
        sql: 'DELETE FROM summaries WHERE client_id = ? AND source_name = ?',
        args: [clientId || '', source_name],
      });
    }
  }
}

// ---- Cross-source report (per client; '' = shared) ------------------------
async function saveCrossSourceReport(report, clientId = '') {
  await ready();
  await client.execute({
    sql: `INSERT INTO reports (client_id, executive_summary, themes, markdown, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(client_id) DO UPDATE SET
            executive_summary=excluded.executive_summary, themes=excluded.themes,
            markdown=excluded.markdown, updated_at=excluded.updated_at`,
    args: [
      clientId || '',
      report.executiveSummary || '',
      JSON.stringify(report.themes || []),
      report.markdown || '',
      report.updatedAt || new Date().toISOString(),
    ],
  });
}

async function getCrossSourceReport(clientId = '') {
  await ready();
  const row = (
    await client.execute({ sql: 'SELECT * FROM reports WHERE client_id = ?', args: [clientId || ''] })
  ).rows[0];
  if (!row) return { executiveSummary: '', themes: [], markdown: '', updatedAt: null };
  return {
    executiveSummary: row.executive_summary || '',
    themes: safeParse(row.themes, []),
    markdown: row.markdown || '',
    updatedAt: row.updated_at,
  };
}

// ---- Digest subscribers ---------------------------------------------------
async function getSubscribers() {
  await ready();
  const res = await client.execute('SELECT email FROM subscribers ORDER BY created_at');
  return res.rows.map((r) => r.email);
}

async function addSubscriber(email) {
  await ready();
  const normalized = String(email || '').trim().toLowerCase();
  const res = await client.execute({
    sql: 'INSERT OR IGNORE INTO subscribers (email) VALUES (?)',
    args: [normalized],
  });
  return res.rowsAffected > 0;
}

async function removeSubscriber(email) {
  await ready();
  const normalized = String(email || '').trim().toLowerCase();
  const res = await client.execute({ sql: 'DELETE FROM subscribers WHERE email = ?', args: [normalized] });
  return res.rowsAffected > 0;
}

// ---- Per-client custom API keys (encrypted at rest) -----------------------
async function setClientApiKey(clientId, plaintextKey) {
  await ready();
  const id = String(clientId || '').trim();
  const key = String(plaintextKey || '').trim();
  if (!id || !key) throw new Error('Both a client id and an API key are required.');
  await client.execute({
    sql: `INSERT INTO api_keys (client_id, key_enc, last4, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(client_id) DO UPDATE SET
            key_enc=excluded.key_enc, last4=excluded.last4, updated_at=excluded.updated_at`,
    args: [id, encrypt(key), key.slice(-4), new Date().toISOString()],
  });
}

async function getClientApiKeyMeta(clientId) {
  await ready();
  const id = String(clientId || '').trim();
  if (!id) return { hasKey: false, masked: '' };
  const row = (
    await client.execute({ sql: 'SELECT last4, updated_at FROM api_keys WHERE client_id = ?', args: [id] })
  ).rows[0];
  if (!row) return { hasKey: false, masked: '' };
  return { hasKey: true, masked: '••••••••' + (row.last4 || ''), updatedAt: row.updated_at };
}

async function getClientApiKeyPlaintext(clientId) {
  await ready();
  const id = String(clientId || '').trim();
  if (!id) return null;
  const row = (
    await client.execute({ sql: 'SELECT key_enc FROM api_keys WHERE client_id = ?', args: [id] })
  ).rows[0];
  if (!row) return null;
  return decrypt(row.key_enc);
}

async function removeClientApiKey(clientId) {
  await ready();
  const id = String(clientId || '').trim();
  if (!id) return false;
  const res = await client.execute({ sql: 'DELETE FROM api_keys WHERE client_id = ?', args: [id] });
  return res.rowsAffected > 0;
}

// ---- misc -----------------------------------------------------------------
function isFresh(updatedAt, maxAgeMs = 60 * 60 * 1000) {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < maxAgeMs;
}

module.exports = {
  client,
  ready,
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
