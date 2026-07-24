'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const MAX_ARTICLES = 12; // cap per source to keep the LLM prompt small
// Only summarize articles published within this many hours (default 28).
// Configurable via env; set to 0 to disable the recency filter.
const LOOKBACK_HOURS = process.env.DIGEST_LOOKBACK_HOURS !== undefined
  ? Number(process.env.DIGEST_LOOKBACK_HOURS)
  : 28;
const MIN_TITLE_LEN = 18; // ignore nav links / tiny labels
const MAX_TITLE_LEN = 200;

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

// Common non-article link text to reject (nav, chrome, social, etc.).
const JUNK_TITLE =
  /^(skip to|the homepage|the verge|menu|sign in|log ?in|subscribe|newsletter|follow|share|comments?|advertisement|home|search|more|read more|continue reading|next|previous)\b/i;

// Detect a human/ISO date ANYWHERE in an index card's text (e.g. "Jul 22, 2026",
// "22 July 2026", "2026-07-22"). Many date-less HTML news pages (like Anthropic's
// newsroom) render the date as plain text — sometimes mid-card — instead of in a
// machine-readable attribute. Returns the parsed epoch ms plus the text on either
// side of the date, so recency filtering works and the headline can be recovered.
function extractDate(text = '') {
  const s = text.replace(/\s+/g, ' ').trim();
  const patterns = [
    /([A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4})/, // Mon DD, YYYY
    /(\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})/, // DD Mon YYYY
    /(\d{4}-\d{2}-\d{2})/, // ISO YYYY-MM-DD
  ];
  const SEP = /^[\s\u2013\u2014\-|·:,]+|[\s\u2013\u2014\-|·:,]+$/g;
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const t = new Date(m[1]).getTime();
    if (Number.isNaN(t)) continue;
    const before = s.slice(0, m.index).replace(SEP, '').trim();
    const after = s.slice(m.index + m[1].length).replace(SEP, '').trim();
    return { publishedAt: t, before, after };
  }
  return { publishedAt: null, before: s, after: '' };
}

// Read an element's text, inserting a space between separate child nodes so that
// JS-rendered cards which concatenate <span>/<div> blocks (e.g. "TitleCategoryDate
// Description") don't run together into a single unreadable word.
function richText($, el) {
  const parts = [];
  $(el)
    .contents()
    .each((_, node) => {
      parts.push(node.type === 'text' ? $(node).text() : richText($, node));
    });
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  return joined || $(el).text().replace(/\s+/g, ' ').trim();
}

// Does the URL path look like an article (has a slug with words/dates), not a hub page?
function looksLikeArticle(link, baseUrl) {
  try {
    const u = new URL(link);
    const base = new URL(baseUrl);
    // Off-site links are usually fine (syndicated), but skip obvious social/login hosts.
    if (/(facebook|twitter|x\.com|linkedin|youtube|instagram|reddit|mailto)/i.test(u.hostname)) {
      return false;
    }
    const path = u.pathname.replace(/\/+$/, '');
    if (!path || path === base.pathname.replace(/\/+$/, '')) return false; // the hub page itself
    const segments = path.split('/').filter(Boolean);
    // Article slugs typically contain a hyphenated word or a year, and have some depth.
    const hasSlug = segments.some((s) => /[a-z]+-[a-z]+/i.test(s) || /\b20\d{2}\b/.test(s));
    return segments.length >= 2 || hasSlug;
  } catch {
    return false;
  }
}

// Heuristic, source-agnostic extraction of article-like links from a page.
// Works reasonably across news/blog index pages without per-site selectors.
function extractArticles($, baseUrl) {
  const seen = new Set();
  const articles = [];

  const pushCandidate = (title, href, el, { requireArticleLink = true } = {}) => {
    title = (title || '').replace(/\s+/g, ' ').trim();
    // Prefer a machine-readable <time datetime> on/near the element; otherwise
    // fall back to a date printed within the card text.
    let publishedAt = null;
    if (el) {
      const $el = $(el);
      const dt =
        $el.find('time[datetime]').first().attr('datetime') ||
        $el.closest('article, li').find('time[datetime]').first().attr('datetime');
      if (dt) {
        const t = new Date(dt).getTime();
        if (!Number.isNaN(t)) publishedAt = t;
      }
    }
    const d = extractDate(title);
    if (d.publishedAt != null) {
      if (publishedAt == null) publishedAt = d.publishedAt;
      // On index cards the headline precedes the date and the description follows
      // it. Keep the text before the date as the title (drops the description),
      // falling back to the longer/other side if that leaves too little.
      if (d.before && d.before.length >= MIN_TITLE_LEN) title = d.before;
      else if (d.after && d.after.length >= MIN_TITLE_LEN) title = d.after;
    }
    if (!title || title.length < MIN_TITLE_LEN || title.length > MAX_TITLE_LEN) return;
    if (JUNK_TITLE.test(title)) return;
    const link = absoluteUrl(href, baseUrl);
    if (!link) return;
    // Skip obvious non-article links.
    if (/\/(tag|tags|category|categories|author|about|contact|privacy|terms|login|subscribe)\b/i.test(link)) {
      return;
    }
    if (requireArticleLink && !looksLikeArticle(link, baseUrl)) return;
    const key = link; // dedupe by destination, not title
    if (seen.has(key)) return;
    seen.add(key);
    articles.push({ title, link, publishedAt });
  };

  // 1) Prefer headings that contain a link (typical article cards).
  $('h1 a, h2 a, h3 a').each((_, el) => {
    if (articles.length >= MAX_ARTICLES) return false;
    pushCandidate(richText($, el), $(el).attr('href'), el);
  });

  // 2) Then anchors that *wrap* a heading.
  if (articles.length < MAX_ARTICLES) {
    $('a:has(h1), a:has(h2), a:has(h3)').each((_, el) => {
      if (articles.length >= MAX_ARTICLES) return false;
      pushCandidate(richText($, el), $(el).attr('href'), el);
    });
  }

  // 3) Fallback: any link inside an <article> element.
  if (articles.length < MAX_ARTICLES) {
    $('article a').each((_, el) => {
      if (articles.length >= MAX_ARTICLES) return false;
      pushCandidate(richText($, el), $(el).attr('href'), el);
    });
  }

  // 4) Dated anchors anywhere. A date printed in the card text is a strong,
  //    high-precision signal of a real news item, and captures list-style
  //    newsrooms (e.g. Anthropic) whose latest items aren't wrapped in
  //    <article>/<h*>. Footer/product/nav links carry no date, so they're
  //    naturally excluded.
  if (articles.length < MAX_ARTICLES) {
    $('a').each((_, el) => {
      if (articles.length >= MAX_ARTICLES) return false;
      const text = richText($, el);
      if (extractDate(text).publishedAt == null) return; // dated items only
      pushCandidate(text, $(el).attr('href'), el);
    });
  }

  // 5) Last resort: long-text anchors anywhere.
  if (articles.length < 3) {
    $('a').each((_, el) => {
      if (articles.length >= MAX_ARTICLES) return false;
      pushCandidate(richText($, el), $(el).attr('href'), el);
    });
  }

  return articles.slice(0, MAX_ARTICLES);
}

// Strip HTML tags and collapse whitespace from a feed description/summary.
function stripHtml(html = '') {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Detect whether a response body is an RSS/Atom/RDF feed.
function isFeed(body, contentType = '') {
  if (/(rss|atom|xml)/i.test(contentType)) {
    // Content-type says XML — confirm it carries feed items.
    if (/<(item|entry)[\s>]/i.test(body)) return true;
  }
  const head = body.slice(0, 1000);
  return /<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(head);
}

// Parse a feed date string (RSS pubDate / Atom published|updated) into epoch ms,
// or null if absent/unparseable.
function parseFeedDate(s) {
  s = (s || '').trim();
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

// Parse the candidate pool before any date/recency filtering. We read more than
// MAX_ARTICLES here so the recency filter downstream has enough to choose from.
const PARSE_CAP = 50;

// Parse an RSS (<item>) or Atom (<entry>) feed into article objects, each with
// an optional publishedAt (epoch ms) used later for the recency filter.
function parseFeed(body, baseUrl) {
  const $ = cheerio.load(body, { xmlMode: true });
  const articles = [];
  const seen = new Set();

  const push = (title, link, snippet, publishedAt) => {
    title = (title || '').replace(/\s+/g, ' ').trim();
    link = (link || '').trim();
    if (!title || !link) return;
    const abs = absoluteUrl(link, baseUrl);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    articles.push({
      title,
      link: abs,
      snippet: stripHtml(snippet).slice(0, 300),
      publishedAt: publishedAt ?? null,
    });
  };

  // RSS 2.0 / RDF: <item><title/><link>url</link><description/><pubDate/>
  $('item').each((_, el) => {
    if (articles.length >= PARSE_CAP) return false;
    const item = $(el);
    push(
      item.children('title').first().text(),
      item.children('link').first().text(),
      item.children('description').first().text() ||
        item.children('content\\:encoded').first().text(),
      parseFeedDate(
        item.children('pubDate').first().text() || item.children('dc\\:date').first().text()
      )
    );
  });

  // Atom: <entry><title/><link href="url"/><summary|content/><published|updated/>
  if (articles.length === 0) {
    $('entry').each((_, el) => {
      if (articles.length >= PARSE_CAP) return false;
      const entry = $(el);
      // Prefer rel="alternate" link, else the first link with an href.
      let href =
        entry.children('link[rel="alternate"]').attr('href') ||
        entry.children('link').first().attr('href') ||
        entry.children('link').first().text();
      push(
        entry.children('title').first().text(),
        href,
        entry.children('summary').first().text() || entry.children('content').first().text(),
        parseFeedDate(
          entry.children('published').first().text() || entry.children('updated').first().text()
        )
      );
    });
  }

  return articles.slice(0, PARSE_CAP);
}

// Keep only articles published within the last `hours`. Behavior depends on
// whether the source exposes dates at all:
//   - No item has a date (e.g. a feed/page that omits them): keep all, in order.
//   - Some items have dates: keep the dated items within the window. If none are
//     recent, fall back to the LATEST dated items (newest first) so a quiet
//     source still surfaces its most recent real news. Undated items (typically
//     nav/support/footer chrome that slipped through) are dropped once any real
//     dated article exists, so they can't outrank actual news.
function filterRecent(articles, hours) {
  if (!hours || hours <= 0) return articles;
  const dated = articles.filter((a) => a.publishedAt != null);
  if (dated.length === 0) return articles; // nothing to filter on
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const recent = dated.filter((a) => a.publishedAt >= cutoff);
  if (recent.length > 0) return recent;
  return [...dated].sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Scrape a single source. Auto-detects RSS/Atom feeds (preferred — cleaner and
 * rarely blocked) and falls back to HTML heuristics for regular web pages.
 * Never throws — returns a result object so one bad source can't break the rest.
 *
 * @returns {Promise<{ name, url, articles, error }>}
 */
async function scrapeSource(source) {
  const { name, url } = source;
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      // Treat 4xx/5xx as errors we capture rather than throw raw.
      validateStatus: (s) => s >= 200 && s < 400,
    });

    const body = typeof res.data === 'string' ? res.data : String(res.data);
    const contentType = res.headers?.['content-type'] || '';

    let articles;
    if (isFeed(body, contentType)) {
      articles = parseFeed(body, url);
    } else {
      const $ = cheerio.load(body);
      articles = extractArticles($, url);
    }

    if (articles.length === 0) {
      return { name, url, articles: [], error: 'No articles could be extracted from this source.' };
    }

    // Keep only recent articles (today + yesterday by default), then cap for the
    // LLM prompt. filterRecent falls back to latest items if none are recent.
    articles = filterRecent(articles, LOOKBACK_HOURS).slice(0, MAX_ARTICLES);

    return { name, url, articles, error: null };
  } catch (err) {
    let message = err.message || 'Unknown scraping error';
    if (err.response) {
      message = `Request failed with status ${err.response.status}`;
    } else if (err.code === 'ECONNABORTED') {
      message = 'Request timed out';
    } else if (err.code) {
      message = `${err.code}: ${message}`;
    }
    return { name, url, articles: [], error: message };
  }
}

/**
 * Scrape all sources concurrently. Each result is independent.
 * Optionally filter articles by a topic/keyword (case-insensitive substring on the title).
 */
async function scrapeAll(sources, topicFilter = '') {
  const topic = (topicFilter || '').trim().toLowerCase();
  const results = await Promise.all(sources.map((s) => scrapeSource(s)));

  if (!topic) return results;

  return results.map((r) => {
    if (r.error || !r.articles.length) return r;
    const filtered = r.articles.filter(
      (a) =>
        a.title.toLowerCase().includes(topic) ||
        (a.snippet || '').toLowerCase().includes(topic)
    );
    // If the filter removes everything, keep the original set but flag it,
    // so the summarizer/UI can still show something meaningful.
    if (filtered.length === 0) {
      return { ...r, articles: r.articles, topicMatchedNone: true };
    }
    return { ...r, articles: filtered };
  });
}

module.exports = { scrapeSource, scrapeAll, MAX_ARTICLES };
