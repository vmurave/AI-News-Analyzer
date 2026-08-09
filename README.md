# 🤖 AI News Analyzer

A full-stack web app that scrapes AI news from your chosen sources, summarizes each source with an LLM, displays the summaries on a portal, and emails you a clean HTML digest covering the last 7 days every Tuesday at 9:00 AM.

## Features

- **News sources management** — 5 editable defaults (OpenAI, Google AI, VentureBeat AI, MIT Tech Review, The Verge AI); add/remove/edit up to **7** total.
- **Persisted settings** (SQLite) — sources, digest email, optional topic/keyword filter, and LLM provider config.
- **Fetch & summarize** — scrapes titles + article links per source, optionally filters by topic, and asks the LLM for **3–5 bullets + a general-trends line** per source. Results are cached for **1 hour** to avoid re-fetching.
- **Weekly email digest** — sent via `node-cron` every Tuesday at 09:00 (timezone configurable), covering the last 7 days of news, using `nodemailer` + your SMTP settings.
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
DIGEST_CRON=0 9 * * 2        # 09:00 every Tuesday
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

## Deploy to Vercel

This repo is set up for Vercel (`vercel.json` + `api/index.js`). The Express app runs as a
serverless function, the React client is served as static assets, and the weekly digest runs via
**Vercel Cron** (`/api/cron/digest`) instead of `node-cron`.

**1. Database (Turso / libSQL).** Vercel's filesystem is ephemeral, so SQLite-on-disk won't persist.
Create a free **Turso** database (https://turso.tech) and grab its `libsql://…` URL + auth token.
Locally you need nothing — a file DB is auto-created under `data/`.

**2. Import the repo** at https://vercel.com/new and set **Environment Variables**:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `libsql://…` from Turso |
| `DATABASE_AUTH_TOKEN` | Turso token |
| `API_KEY_SECRET` | 32-byte base64/hex — `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `CRON_SECRET` | any long random string (guards the cron endpoint) |
| `GEMINI_API_KEY` | shared Gemini key |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | for the digest email |
| `DIGEST_TIMEZONE` | e.g. `Europe/Berlin` (note: Vercel Cron schedule itself is **UTC**) |

**3. Deploy.** Vercel runs the build (`vercel.json` → builds `client/`) and exposes the API.

> ⚠️ **Timeout caveat:** a full refresh is rate-limited (`LLM_MAX_RPM`, default 5/min), so generating
> all sources can take 1–2 min. Vercel functions cap at **60s (Hobby)** / up to **300s (Pro)**
> (`maxDuration` in `vercel.json`). On Hobby, an on-demand refresh of many sources may time out — use a
> higher-RPM (paid) Gemini key, fewer sources, or Vercel Pro. The weekly cron has the same limit.
>
> ⚠️ **No auth:** settings/sources/subscribers are shared and unauthenticated. Anyone with the URL can
> edit them. Add authentication before sharing a public deployment widely.

## How it works

- **`GET /api/news`** — returns cached summaries; on a cold start it scrapes + summarizes once so the dashboard is populated on first visit.
- **`POST /api/refresh`** — forces a re-scrape + re-summarize of every source (the Refresh button).
- **`GET/PUT /api/settings`** — read/update settings. The saved LLM API key is masked in responses and only overwritten when you type a new one.
- **`POST /api/refresh/send-digest`** — send the digest now (optionally to a one-off `email` in the body, without subscribing).
- **Scheduler** — locally, `node-cron` runs the digest from `DIGEST_CRON` / `DIGEST_TIMEZONE`. On Vercel, **Vercel Cron** hits `/api/cron/digest` (guarded by `CRON_SECRET`).

## LLM configuration

- **Gemini (default):** uses the `GEMINI_API_KEY` from the environment. Users can save their own key (encrypted, per-browser) on the Settings page to avoid the shared quota.

## Notes & limitations

- Scraping uses **generic heuristics** (headings/links inside article cards) so it works across sites without per-site selectors — but some sites block bots or render via JS, in which case that source's card shows an error. Swap in a different/working source on the Settings page.
- The topic filter is a case-insensitive substring match on article titles. If nothing matches for a source, the latest articles are summarized instead and the card notes this.
- Data is stored in libSQL — locally a file under `data/` (git-ignored), in production your Turso database.
