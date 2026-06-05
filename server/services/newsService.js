'use strict';

const db = require('../db');
const { scrapeAll } = require('./scraper');
const { summarizeSource, analyzeCrossSource, describeLlmError } = require('./summarizer');
const { buildReportMarkdown } = require('./reportGenerator');

const ONE_HOUR_MS = 60 * 60 * 1000;

// User-facing message when a request used the requester's own (custom) key and
// generation failed. We deliberately never retry with the shared key.
function customKeyErrorMessage(reason) {
  return (
    'Your personal API key could not be used (' + reason + '). ' +
    'It may be invalid, expired, or out of quota. Update or remove it in Settings.'
  );
}

// Resolve the cache namespace + key for a request. A browser only gets its OWN
// namespace (and uses its own key) when it actually has a custom key saved;
// otherwise it shares the default ('') cache generated with the shared key, so
// everyone benefits from a single generation.
async function resolveContext(clientId = '') {
  const customKey = clientId ? (await db.getClientApiKeyPlaintext(clientId)) || '' : '';
  return { customKey, ns: customKey ? clientId : '' };
}

/**
 * Return cached summaries for all configured sources (for the given client
 * namespace), pruning stale entries for removed sources. Also returns the
 * cached cross-source report.
 */
async function getCachedNews(clientId = '') {
  const settings = await db.getSettings();
  const { ns } = await resolveContext(clientId);
  await db.pruneSummaries(settings.sources.map((s) => s.name), ns);
  // Return one entry per configured source (cached or null placeholder).
  const cache = new Map((await db.getAllSummaries(ns)).map((s) => [s.sourceName, s]));
  const items = settings.sources.map((s) => {
    const cached = cache.get(s.name);
    if (cached) return cached;
    return {
      sourceName: s.name,
      sourceUrl: s.url,
      executiveSummary: '',
      themes: [],
      articles: [],
      error: null,
      updatedAt: null,
    };
  });
  return { items, report: await db.getCrossSourceReport(ns), settings };
}

/**
 * Synthesize the cross-source analysis from the full per-source set, assemble
 * the Markdown report, persist it (in the client namespace), and return it.
 * Never throws.
 */
async function generateCrossSourceReport(items, settings, { clientId = '', customKey = '' } = {}) {
  let cross = { executiveSummary: '', themes: [] };
  try {
    cross = await analyzeCrossSource(items, settings, customKey);
  } catch (err) {
    const reason = describeLlmError(err);
    cross = {
      executiveSummary: '',
      themes: [],
      error: customKey
        ? customKeyErrorMessage(reason)
        : `Cross-source analysis failed: ${reason}`,
    };
  }
  const markdown = buildReportMarkdown(cross, items);
  const report = { ...cross, markdown, updatedAt: new Date().toISOString() };
  await db.saveCrossSourceReport(report, clientId);
  return report;
}

/**
 * Scrape + summarize all configured sources, then synthesize the cross-source report.
 * @param {object} opts
 * @param {boolean} opts.force     When false, reuse cached summaries < 1h old.
 * @param {string}  opts.clientId  Browser/client namespace ('' = shared default).
 * @returns {Promise<{ items: Array, report: object }>} per-source summaries + cross-source report
 */
async function refreshNews({ force = false, clientId = '' } = {}) {
  const settings = await db.getSettings();

  // A custom key (if saved for this browser) is used for ALL generation in this
  // request and we never silently fall back to the shared key. Without a custom
  // key the request reads/writes the shared ('') namespace.
  const { customKey, ns } = await resolveContext(clientId);
  await db.pruneSummaries(settings.sources.map((s) => s.name), ns);

  // Decide which sources actually need a (re)fetch.
  const toFetch = [];
  const results = [];

  for (const source of settings.sources) {
    const cached = await db.getSummary(source.name, ns);
    if (!force && cached && !cached.error && db.isFresh(cached.updatedAt, ONE_HOUR_MS)) {
      results.push(cached); // reuse fresh cache
    } else {
      toFetch.push(source);
    }
  }

  if (toFetch.length === 0) {
    // Everything was fresh — return cached per-source data and cached report.
    return {
      items: orderByConfig(settings.sources, results),
      report: await db.getCrossSourceReport(ns),
    };
  }

  // Scrape the sources that need refreshing (concurrent, fault-tolerant).
  const scraped = await scrapeAll(toFetch, settings.topicFilter);

  // Summarize one source at a time. Pacing is enforced centrally by the shared
  // LLM rate limiter (see services/rateLimiter.js, default 5 requests/minute),
  // which also covers retries — so we never exceed the provider's RPM cap.
  // Doing this sequentially keeps one LLM failure from sinking the others.
  const summarized = [];

  for (const s of scraped) {
    const updatedAt = new Date().toISOString();
    if (s.error) {
      summarized.push({
        sourceName: s.name,
        sourceUrl: s.url,
        executiveSummary: '',
        themes: [],
        articles: [],
        error: s.error,
        updatedAt,
      });
      continue;
    }
    try {
      const { executiveSummary, themes } = await summarizeSource(s.name, s.articles, settings, customKey);
      summarized.push({
        sourceName: s.name,
        sourceUrl: s.url,
        executiveSummary,
        themes,
        articles: s.articles,
        error: s.topicMatchedNone
          ? `No articles matched topic "${settings.topicFilter}"; showing latest instead.`
          : null,
        updatedAt,
      });
    } catch (err) {
      const reason = describeLlmError(err);
      summarized.push({
        sourceName: s.name,
        sourceUrl: s.url,
        executiveSummary: '',
        themes: [],
        articles: s.articles,
        // No silent fallback to the shared key — surface a clear, key-specific error.
        error: customKey ? customKeyErrorMessage(reason) : `Summarization failed: ${reason}`,
        updatedAt,
      });
    }
  }

  // Persist freshly computed summaries (in the resolved namespace).
  for (const summary of summarized) await db.upsertSummary(summary, ns);

  const items = orderByConfig(settings.sources, [...results, ...summarized]);
  // Synthesize + persist the cross-source report from the full set.
  const report = await generateCrossSourceReport(items, settings, { clientId: ns, customKey });
  return { items, report };
}

function orderByConfig(sources, summaries) {
  const byName = new Map(summaries.map((s) => [s.sourceName, s]));
  return sources.map((s) => byName.get(s.name)).filter(Boolean);
}

module.exports = { getCachedNews, refreshNews, generateCrossSourceReport, ONE_HOUR_MS };
