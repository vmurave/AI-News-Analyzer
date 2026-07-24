'use strict';

const axios = require('axios');
const { llmRateLimiter } = require('./rateLimiter');

/**
 * Resolve the effective LLM config from saved settings + environment.
 * - provider 'gemini' uses GEMINI_API_KEY from .env unless the user saved a custom key.
 * - provider 'custom' uses an OpenAI-compatible chat-completions endpoint.
 */
function resolveLlmConfig(settings, overrideKey = '') {
  const provider = settings.llmProvider === 'custom' ? 'custom' : 'gemini';
  const custom = String(overrideKey || '').trim();
  if (provider === 'gemini') {
    return {
      provider,
      // A user's own (custom) key takes precedence over the shared default.
      apiKey: custom || settings.llmApiKey || process.env.GEMINI_API_KEY || '',
      model: settings.llmModel || 'gemini-3.1-flash-lite',
      endpoint: '', // built from model name
      usingCustomKey: Boolean(custom),
    };
  }
  return {
    provider,
    apiKey: custom || settings.llmApiKey || '',
    model: settings.llmModel || 'gpt-4o-mini',
    endpoint: settings.llmEndpoint || 'https://api.openai.com/v1',
    usingCustomKey: Boolean(custom),
  };
}

// Map an LLM/transport error to a short, key-safe reason (never echoes the key
// or a key-bearing URL).
function describeLlmError(err) {
  const status = err.response?.status;
  if (status === 401 || status === 403) return 'authentication failed (key invalid or unauthorized)';
  if (status === 429) return 'rate limit or quota exceeded';
  if (status === 400) return 'request rejected (key may be invalid)';
  if (err.code === 'ECONNABORTED') return 'request timed out';
  return err.message || 'unknown error';
}

// ---- Single-source analysis prompt ---------------------------------------
// Produces an executive summary plus up to 3 themes, each with a detailed
// topic overview, a "why it matters" strategic implication, and one link.
function buildSourcePrompt(sourceName, articles, topicFilter) {
  const list = articles
    .map((a, i) => {
      const snippet = a.snippet ? `\n   Snippet: ${a.snippet}` : '';
      return `${i + 1}. ${a.title}${a.link ? ` (${a.link})` : ''}${snippet}`;
    })
    .join('\n');

  const topicLine = topicFilter
    ? `\nThe user is specifically interested in the topic: "${topicFilter}". Emphasize anything related to it.`
    : '';

  return (
    `You are a senior AI industry analyst writing an executive-facing report. ` +
    `Analyze the latest articles from the source "${sourceName}".${topicLine}\n\n` +
    `Articles (title, link, and snippet) scraped from the source:\n${list}\n\n` +
    `Identify up to THREE strong, well-supported themes. If fewer than three themes are ` +
    `genuinely well supported by the articles, return only the ones that are. Prioritize ` +
    `insight over raw aggregation — group related stories into a theme rather than listing each article.\n\n` +
    `Respond with STRICT JSON only (no markdown, no code fences) in this EXACT shape:\n` +
    `{\n` +
    `  "executiveSummary": "2-3 sentence summary of the most important developments from this source and what they indicate about its strategic direction or industry relevance. DO NOT include any links or URLs here.",\n` +
    `  "themes": [\n` +
    `    {\n` +
    `      "name": "short theme name",\n` +
    `      "topicOverview": "a detailed explanation of the topic: the key announcement/development, context, and what changed — detailed enough that the reader understands it without opening the link",\n` +
    `      "whyItMatters": "the strategic implication for the AI market, enterprises, customers, competitors, or technology direction",\n` +
    `      "link": "the single most relevant article URL for this theme, copied verbatim from the list above"\n` +
    `    }\n` +
    `  ]\n` +
    `}\n` +
    `Use clear, executive-friendly language. Only use links that appear in the article list above. ` +
    `Do not invent stories that are not implied by the articles.`
  );
}

// ---- Cross-source analysis prompt -----------------------------------------
// Synthesizes patterns ACROSS all sources into an executive summary plus up to
// 3 cross-source themes, each backed by evidence drawn from multiple sources.
function buildCrossSourcePrompt(perSource, topicFilter) {
  const blocks = perSource
    .map((s) => {
      const themes = (s.themes || [])
        .map(
          (t) =>
            `   - ${t.name}: ${t.topicOverview}${t.link ? `\n     Link: ${t.link}` : ''}`
        )
        .join('\n');
      const summary = s.executiveSummary ? `\n   Summary: ${s.executiveSummary}` : '';
      return `Source "${s.sourceName}":${summary}\n${themes || '   (no themes)'}`;
    })
    .join('\n\n');

  const topicLine = topicFilter
    ? `\nThe user is specifically interested in the topic: "${topicFilter}". Emphasize anything related to it.`
    : '';

  return (
    `You are a senior AI industry analyst writing the cross-source section of an executive report. ` +
    `Below are per-source analyses of today's AI news.${topicLine}\n\n` +
    `${blocks}\n\n` +
    `Synthesize PATTERNS that appear ACROSS MULTIPLE sources — do not just repeat a single source's ` +
    `story. Identify up to THREE strong cross-source themes. If fewer than three are well supported by ` +
    `evidence from more than one source, return only those that are.\n\n` +
    `Respond with STRICT JSON only (no markdown, no code fences) in this EXACT shape:\n` +
    `{\n` +
    `  "executiveSummary": "3-5 sentence summary that a reader could ONLY have written from TODAY'S specific articles above. CRITICAL RULE 1: Your very first word MUST be a specific company name, product name, or person's name taken directly from today's articles (e.g. 'OpenAI', 'Google', 'Meta', 'Anthropic', etc.). NEVER begin with 'The AI industry', 'AI companies', 'The industry', 'Major players', 'Leading companies', 'Amid', 'As', 'In a', or any other general framing — if you do, the response is invalid. CRITICAL RULE 2: Ground EVERY sentence in concrete, day-specific detail — name the actual products, model versions, funding amounts, features, partnerships, research results, incidents, or people reported TODAY. Forbidden: vague evergreen statements that could describe any week in AI, such as 'companies are pivoting to vertical integration', 'the industry is racing to scale', 'firms face mounting regulatory and energy pushback', or 'this shift is characterized by agentic workflows'. Litmus test: if a sentence would have been equally true last month, DELETE it and replace it with a specific fact from today's articles. Lead with the single biggest concrete story of the day, then cover the other most newsworthy specifics and their strategic implications. DO NOT include any links or URLs here.",\n` +
    `  "themes": [\n` +
    `    {\n` +
    `      "name": "short cross-source theme name",\n` +
    `      "evidence": [\n` +
    `        { "source": "exact source name", "topic": "short topic description", "link": "the relevant article URL copied verbatim from above" }\n` +
    `      ],\n` +
    `      "whyItMatters": "why this cross-source theme is strategically important (business, market, or technology impact)"\n` +
    `    }\n` +
    `  ]\n` +
    `}\n` +
    `Each theme's evidence should ideally cite more than one source. Use clear, executive-friendly language. ` +
    `Only use links and source names that appear above.`
  );
}

// Pull a JSON object out of an LLM text response that may include stray text/fences.
function parseLlmJson(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // Strip ```json ... ``` fences if present.
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: grab the first {...} block.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Normalize a single-source analysis into { executiveSummary, themes[] }.
function normalizeSourceResult(parsed, articles) {
  let executiveSummary = '';
  let themes = [];

  if (parsed) {
    executiveSummary = str(parsed.executiveSummary);
    if (Array.isArray(parsed.themes)) {
      themes = parsed.themes
        .map((t) => ({
          name: str(t && t.name),
          topicOverview: str(t && t.topicOverview),
          whyItMatters: str(t && t.whyItMatters),
          link: str(t && t.link),
        }))
        .filter((t) => t.name && (t.topicOverview || t.whyItMatters))
        .slice(0, 3);
    }
  }

  // Defensive fallback if the model returned nothing usable.
  if (themes.length === 0) {
    themes = articles.slice(0, 3).map((a) => ({
      name: a.title,
      topicOverview: a.snippet || a.title,
      whyItMatters: '',
      link: a.link || '',
    }));
  }
  if (!executiveSummary) {
    executiveSummary = themes.length
      ? 'Summary unavailable — showing the most notable stories from this source.'
      : 'No notable developments could be extracted from this source.';
  }
  return { executiveSummary, themes };
}

// Normalize a cross-source analysis into { executiveSummary, themes[] }.
function normalizeCrossSourceResult(parsed) {
  let executiveSummary = '';
  let themes = [];

  if (parsed) {
    executiveSummary = str(parsed.executiveSummary);
    if (Array.isArray(parsed.themes)) {
      themes = parsed.themes
        .map((t) => ({
          name: str(t && t.name),
          whyItMatters: str(t && t.whyItMatters),
          evidence: Array.isArray(t && t.evidence)
            ? t.evidence
                .map((e) => ({
                  source: str(e && e.source),
                  topic: str(e && e.topic),
                  link: str(e && e.link),
                }))
                .filter((e) => e.source && e.topic)
            : [],
        }))
        .filter((t) => t.name && t.evidence.length > 0)
        .slice(0, 3);
    }
  }
  return { executiveSummary, themes };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A per-source LLM reply is "usable" only if the model itself produced a real
// summary AND at least one real theme. When it returns empty/unparseable
// content, this is false and we retry instead of falling back to raw titles.
function isUsableSourceParse(parsed) {
  if (!parsed) return false;
  const hasSummary = str(parsed.executiveSummary).length > 0;
  const hasTheme =
    Array.isArray(parsed.themes) &&
    parsed.themes.some((t) => t && str(t.name) && (str(t.topicOverview) || str(t.whyItMatters)));
  return hasSummary && hasTheme;
}

// Same idea for the cross-source synthesis.
function isUsableCrossParse(parsed) {
  if (!parsed) return false;
  const hasSummary = str(parsed.executiveSummary).length > 0;
  const hasTheme = Array.isArray(parsed.themes) && parsed.themes.some((t) => t && str(t.name));
  return hasSummary && hasTheme;
}

async function callGemini({ apiKey, model }, prompt, { temperature = 0.3 } = {}) {
  if (!apiKey) {
    throw new Error('Missing Gemini API key. Set GEMINI_API_KEY in .env or add a custom key in Settings.');
  }
  // Authenticate via the x-goog-api-key header (NOT a query param) so the key
  // never appears in a URL that could surface in logs or error messages.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const generationConfig = {
    temperature,
    maxOutputTokens: 2048,
    // Force native JSON output (no markdown fences).
    responseMimeType: 'application/json',
    // Gemini 2.x are "thinking" models; without this the thinking step can
    // consume the whole token budget and return empty content. Disabling it
    // keeps the budget for the actual answer (and is faster/cheaper).
    thinkingConfig: { thinkingBudget: 0 },
  };

  const post = async (cfg) => {
    // Acquire a rate-limiter slot before EVERY request (incl. retries) so we
    // never exceed the provider's requests-per-minute cap.
    await llmRateLimiter.acquire();
    return axios.post(
      url,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: cfg },
      {
        timeout: 45000,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      }
    );
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Retry transient failures (503 overloaded / 429 rate-limited / timeouts),
  // common on the Gemini free tier, with a short exponential backoff.
  const postWithRetry = async (cfg, attempts = 3) => {
    for (let i = 0; i < attempts; i++) {
      try {
        return await post(cfg);
      } catch (err) {
        const status = err.response?.status;
        const transient = status === 503 || status === 429 || err.code === 'ECONNABORTED';
        if (transient && i < attempts - 1) {
          // 429 = per-minute rate limit → wait longer; 503/timeout → short backoff.
          const backoff = status === 429 ? 6000 * (i + 1) : 1000 * (i + 1);
          await sleep(backoff);
          continue;
        }
        throw err;
      }
    }
  };

  let res;
  try {
    res = await postWithRetry(generationConfig);
  } catch (err) {
    // Some models (e.g. gemini-*-pro) reject thinkingBudget: 0 with a 400.
    // Retry once without the thinkingConfig.
    if (err.response?.status === 400) {
      const { thinkingConfig, ...rest } = generationConfig;
      res = await postWithRetry(rest);
    } else {
      throw err;
    }
  }

  const text =
    res.data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  return text;
}

async function callOpenAiCompatible({ apiKey, model, endpoint }, prompt, { temperature = 0.3 } = {}) {
  if (!apiKey) throw new Error('Missing API key for custom LLM provider.');
  const base = endpoint.replace(/\/+$/, '');
  // Allow either a base URL (".../v1") or a full ".../chat/completions" URL.
  const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;

  await llmRateLimiter.acquire(); // honor the shared RPM cap
  const res = await axios.post(
    url,
    {
      model,
      messages: [
        { role: 'system', content: 'You are an AI news analyst that responds with strict JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature,
    },
    {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    }
  );

  return res.data?.choices?.[0]?.message?.content ?? '';
}

// Dispatch a prompt to the configured provider and return the raw text.
// `options.temperature` lets callers trade determinism (low) for variety (high).
async function callLlm(cfg, prompt, options = {}) {
  return cfg.provider === 'gemini'
    ? callGemini(cfg, prompt, options)
    : callOpenAiCompatible(cfg, prompt, options);
}

/**
 * Analyze one source's scraped articles via the configured LLM.
 * @param {string} overrideKey  the requesting user's custom API key, if any
 * Returns { executiveSummary, themes[] }. The caller handles errors.
 */
async function summarizeSource(sourceName, articles, settings, overrideKey = '') {
  const cfg = resolveLlmConfig(settings, overrideKey);
  const prompt = buildSourcePrompt(sourceName, articles, settings.topicFilter);

  // These models occasionally return empty/unparseable content even on HTTP 200.
  // Retry a couple of times before falling back to raw article titles.
  const MAX_TRIES = 3;
  let parsed = null;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const text = await callLlm(cfg, prompt);
    parsed = parseLlmJson(text);
    if (isUsableSourceParse(parsed)) break;
    if (attempt < MAX_TRIES) await sleep(500);
  }
  return normalizeSourceResult(parsed, articles);
}

/**
 * Synthesize a cross-source analysis from the per-source results.
 * @param {Array} perSource  array of { sourceName, executiveSummary, themes }
 * @param {string} overrideKey  the requesting user's custom API key, if any
 * @returns {Promise<{ executiveSummary, themes[] }>}
 */
async function analyzeCrossSource(perSource, settings, overrideKey = '') {
  // Only consider sources that actually produced themes.
  const usable = (perSource || []).filter((s) => (s.themes || []).length > 0);
  if (usable.length === 0) {
    return { executiveSummary: '', themes: [] };
  }
  const cfg = resolveLlmConfig(settings, overrideKey);
  const prompt = buildCrossSourcePrompt(usable, settings.topicFilter);

  // Use a higher temperature here than for single-source analysis: the cross-source
  // summary is a synthesis-of-summaries and, at low temperature, re-converges on the
  // same evergreen "industry trends" wording every day. More variety keeps it fresh
  // and closer to the day's specific news.
  const MAX_TRIES = 3;
  let parsed = null;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const text = await callLlm(cfg, prompt, { temperature: 0.75 });
    parsed = parseLlmJson(text);
    if (isUsableCrossParse(parsed)) break;
    if (attempt < MAX_TRIES) await sleep(500);
  }
  return normalizeCrossSourceResult(parsed);
}

module.exports = { summarizeSource, analyzeCrossSource, resolveLlmConfig, describeLlmError };
