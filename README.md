# 🤖 AI News Analyzer

A full-stack web app that scrapes AI news from your chosen sources daily, summarizes each source with an LLM, displays the summaries on a portal, and emails you a clean HTML digest every morning at 8:00 AM.

## Features

- **News sources management** — 5 editable defaults (OpenAI, Google AI, VentureBeat AI, MIT Tech Review, The Verge AI); add/remove/edit up to **7** total.
- **Persisted settings** (SQLite) — sources, digest email, optional topic/keyword filter, and LLM provider config.
- **Fetch & summarize** — scrapes titles + article links per source, optionally filters by topic, and asks the LLM for **3–5 bullets + a general-trends line** per source. Results are cached for **1 hour** to avoid re-fetching.
- **Daily email digest** — sent via `node-cron` at 08:00 (timezone configurable) using `nodemailer` + your SMTP settings.
- **Modern UI** — React + Tailwind dashboard with per-source summary cards (favicons, bullets, article links), a Refresh button, last-updated timestamp, a full Settings page, and **dark mode**.
- **Fault tolerant** — a failed/blocked source shows an error on its own card without breaking the others.

## Tech Stack

Frontend: React + Tailwind CSS (Vite) · Backend: Node.js + Express · DB: SQLite (`better-sqlite3`) · Scheduler: `node-cron` · Scraping: `axios` + `cheerio` · Email: `nodemailer` · LLM: Google Gemini (default, free tier) with support for any OpenAI-compatible endpoint.

## Project Structure

```
ai-news-analyzer/
├── client/                  # React frontend (Vite + Tailwind)
│   └── src/
│       ├── pages/           # Dashboard.jsx, Settings.jsx
│       ├── components/      # SummaryCard.jsx
│       ├── api.js           # API client
│       └── App.jsx          # shell, routing, dark-mode toggle
├── server/
│   ├── index.js             # Express entry + static client serving
│   ├── db.js                # SQLite schema & queries (settings + summaries)
│   ├── routes/              # settings.js, news.js, refresh.js
│   └── services/            # scraper.js, summarizer.js, mailer.js, scheduler.js, newsService.js
├── .env                     # your secrets (git-ignored)
├── .env.example
└── package.json
```

## Setup

### 1. Install dependencies

```bash
npm run install:all      # installs root (server) + client deps
```

> `better-sqlite3` builds a native module. On Windows you need build tools
> (`npm install --global windows-build-tools` or the "Desktop development with C++"
> workload in Visual Studio Build Tools). On most systems the prebuilt binary is used automatically.

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```ini
GEMINI_API_KEY=your_default_gemini_key   # get one at https://aistudio.google.com/apikey

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_app_password
EMAIL_FROM=you@gmail.com

PORT=3000

DIGEST_TIMEZONE=UTC          # e.g. America/New_York, Europe/Berlin
DIGEST_CRON=0 8 * * *        # 08:00 daily
```

### 3. Run

**Development** (Express on :3000 + Vite dev server on :5173 with API proxy):

```bash
npm run dev
```

Open **http://localhost:5173**.

**Production** (build the client, serve everything from Express):

```bash
npm run build
npm start
```

Open **http://localhost:3000**.

## How it works

- **`GET /api/news`** — returns cached summaries; on a cold start it scrapes + summarizes once so the dashboard is populated on first visit.
- **`POST /api/refresh`** — forces a re-scrape + re-summarize of every source (the Refresh button).
- **`GET/PUT /api/settings`** — read/update settings. The saved LLM API key is masked in responses and only overwritten when you type a new one.
- **`POST /api/refresh/send-digest`** — send the digest email immediately (the "Send test digest now" button), handy for verifying SMTP.
- **Scheduler** — on boot, `node-cron` schedules the digest job from `DIGEST_CRON` / `DIGEST_TIMEZONE`. The job force-refreshes all sources, then emails the HTML digest to the configured address.

## LLM configuration

- **Gemini (default):** uses `gemini-1.5-flash` and the `GEMINI_API_KEY` from `.env`. You can override the key/model from the Settings page.
- **Custom (OpenAI-compatible):** set the provider to *Custom* in Settings and provide a base endpoint (e.g. `https://api.openai.com/v1`), model name, and API key. Requests go to `<endpoint>/chat/completions` with a `Bearer` token.

## Notes & limitations

- Scraping uses **generic heuristics** (headings/links inside article cards) so it works across sites without per-site selectors — but some sites block bots or render via JS, in which case that source's card shows an error. Swap in a different/working source on the Settings page.
- The topic filter is a case-insensitive substring match on article titles. If nothing matches for a source, the latest articles are summarized instead and the card notes this.
- Data lives in `data/ai-news-analyzer.sqlite` (git-ignored).
