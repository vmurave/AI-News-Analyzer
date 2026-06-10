import { useEffect, useState } from 'react';
import { api } from '../api.js';

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const label = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1';
const card =
  'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900';

export default function Settings() {
  const [loaded, setLoaded] = useState(false);
  const [maxSources, setMaxSources] = useState(7);
  const [defaultSources, setDefaultSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null); // { type, msg }
  const [subEmail, setSubEmail] = useState('');
  const [subBusy, setSubBusy] = useState(false);
  // The subscription form is LOCAL only — these choices are sent to the digest
  // admin on Subscribe and never change the global settings or the dashboard.
  const [subSources, setSubSources] = useState([]);
  const [subTopic, setSubTopic] = useState('');
  const [digestBusy, setDigestBusy] = useState(false);

  function flash(type, msg, ms = 4000) {
    setToast({ type, msg });
    // ms <= 0 keeps the toast until the next flash (used for "sending…").
    if (ms > 0) setTimeout(() => setToast(null), ms);
  }

  async function load() {
    setLoading(true);
    try {
      const data = await api.getSettings();
      setMaxSources(data.maxSources || 7);
      const defaults = data.defaultSources || data.sources || [];
      setDefaultSources(defaults);
      // Always start from the canonical default source list every time the page
      // opens — prior edits are not persisted, so users consistently see these.
      setSubSources(defaults);
      setLoaded(true);
    } catch (e) {
      flash('error', e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function subscribe() {
    const email = subEmail.trim();
    if (!email) {
      flash('error', '❌ Please enter your email address to subscribe.');
      return;
    }
    // Client-side check for instant feedback (server validates too).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      flash('error', `❌ "${email}" is not a valid email address. Please check it and try again.`);
      return;
    }
    setSubBusy(true);
    try {
      const sources = subSources.filter((src) => src.name.trim() && src.url.trim());
      const data = await api.subscribe(email, sources, subTopic);
      if (data.added) {
        // New subscription succeeded.
        setSubEmail('');
        if (data.welcomeSent) {
          flash(
            'success',
            `✅ Subscription successful! A welcome digest is on its way to ${email}, and you'll get the daily AI news digest every morning at 8:00 AM.`,
            7000
          );
        } else {
          // Subscribed, but the immediate welcome digest couldn't be sent.
          flash(
            'info',
            `✅ Subscribed! You'll receive the daily digest at 8:00 AM. (The welcome digest couldn't be sent now: ${data.welcomeReason || 'unknown reason'})`,
            9000
          );
        }
      } else {
        // Request was valid but no new subscription was created.
        flash('info', `ℹ️ ${email} is already subscribed — you're all set, no action needed.`, 6000);
      }
    } catch (e) {
      // Server rejected it (invalid email, server/DB error, …) — show the reason.
      flash('error', `❌ Subscription failed: ${e.message}`, 9000);
    } finally {
      setSubBusy(false);
    }
  }

  // Self-service unsubscribe: you remove your own address by typing it in.
  async function unsubscribe() {
    const email = subEmail.trim();
    if (!email) {
      flash('error', '❌ Please enter the email address you want to unsubscribe.');
      return;
    }
    setSubBusy(true);
    try {
      await api.unsubscribe(email);
      setSubEmail('');
      flash(
        'success',
        `✅ Subscription cancelled — ${email} has been removed from the subscribers list and will no longer receive the daily digest.`,
        6000
      );
    } catch (e) {
      // e.g. 404 "That email is not subscribed."
      flash('error', `❌ Could not cancel subscription: ${e.message}`, 9000);
    } finally {
      setSubBusy(false);
    }
  }

  // All source edits are LOCAL to the subscription form (sent to the admin on
  // Subscribe). They never touch the global settings or the dashboard.
  function updateSource(i, key, value) {
    setSubSources((prev) => prev.map((src, idx) => (idx === i ? { ...src, [key]: value } : src)));
  }

  function addSource() {
    // New rows are editable (name + link); preset sources are name-only/read-only.
    setSubSources((prev) =>
      prev.length >= maxSources ? prev : [...prev, { name: '', url: '', isNew: true }]
    );
  }

  function removeSource(i) {
    setSubSources((prev) => prev.filter((_, idx) => idx !== i));
  }

  function resetSources() {
    setSubSources(defaultSources);
    flash('success', 'Sources reset to defaults.');
  }

  async function sendTestDigest() {
    // If an email is typed in the box, send a one-off digest to it (no
    // subscription); otherwise send to all current subscribers.
    const oneOff = subEmail.trim();
    setDigestBusy(true);
    flash('success', 'Sending digest…', 0); // keep visible until we have a result
    try {
      const result = await api.sendDigest(oneOff || undefined);
      const count = result?.recipients;
      const where = oneOff
        ? oneOff
        : count != null
          ? `${count} subscriber${count === 1 ? '' : 's'}`
          : 'subscribers';
      flash('success', `✅ Digest sent to ${where}.`, 6000);
    } catch (e) {
      // Surface the server's reason (SMTP error, no recipients, invalid email, …).
      flash('error', `❌ Failed to send digest: ${e.message}`, 9000);
    } finally {
      setDigestBusy(false);
    }
  }

  if (loading || !loaded) {
    return <div className="text-slate-500">Loading settings…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Settings</h2>
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-lg p-3 text-sm ${
            toast.type === 'error'
              ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
              : toast.type === 'info'
                ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Daily Digest Subscription — includes the per-subscription source list */}
      <section className={card}>
        <h3 className="text-lg font-semibold">Daily Digest Subscription</h3>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Enter your email, choose the sources you want summarized, add any topics of interest, and
          subscribe to receive the daily AI news summary at 8:00 AM.
        </p>

        {/* 1) Email */}
        <div>
          <label className={label}>Your email</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} flex-1 min-w-[220px]`}
              type="email"
              placeholder="you@example.com"
              value={subEmail}
              onChange={(e) => setSubEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && subscribe()}
            />
            <button onClick={sendTestDigest} disabled={digestBusy} className="btn btn-ghost">
              {digestBusy ? 'Sending…' : '✉ Send digest'}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {subEmail.trim()
              ? `Sends a one-off digest to ${subEmail.trim()} without subscribing.`
              : 'Sends to all subscribers. Type an email above to send a one-off digest without subscribing.'}
          </p>
        </div>

        {/* 2) Sources for the subscription */}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <label className={label} style={{ marginBottom: 0 }}>
                Sources for your summary
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {subSources.length}/{maxSources} sources
              </p>
            </div>
            <button onClick={resetSources} className="btn btn-ghost">
              Reset to defaults
            </button>
          </div>

          <div className="space-y-3">
            {subSources.map((src, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                {src.isNew ? (
                  <>
                    <input
                      className={`${input} sm:w-44`}
                      placeholder="Source name"
                      value={src.name}
                      onChange={(e) => updateSource(i, 'name', e.target.value)}
                    />
                    <input
                      className={`${input} flex-1 min-w-[200px]`}
                      placeholder="https://example.com/feed (RSS/Atom URL)"
                      value={src.url}
                      onChange={(e) => updateSource(i, 'url', e.target.value)}
                    />
                  </>
                ) : (
                  <span className="flex-1 min-w-[200px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {src.name}
                  </span>
                )}
                <button onClick={() => removeSource(i)} className="btn btn-danger" title="Remove source">
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button onClick={addSource} disabled={subSources.length >= maxSources} className="btn btn-ghost mt-4">
            + Add source
          </button>
          <p className="mt-2 text-xs text-slate-400">
            These sources are part of your subscription request only — editing them does not change the
            dashboard or other people's digests.
          </p>
        </div>

        {/* 3) Topics */}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <label className={label}>Topics you’re interested in (optional)</label>
          <input
            className={input}
            placeholder="e.g. LLM, robotics, image generation"
            value={subTopic}
            onChange={(e) => setSubTopic(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">
            Saved with your subscription to tailor your daily summary to your interests.
          </p>
        </div>

        {/* 4) Subscribe / Unsubscribe */}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={subscribe} disabled={subBusy || !subEmail.trim()} className="btn btn-accent">
              {subBusy ? 'Working…' : 'Subscribe'}
            </button>
            <button onClick={unsubscribe} disabled={subBusy || !subEmail.trim()} className="btn btn-danger">
              Unsubscribe
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            When you subscribe, your email and chosen sources are saved to your subscription. The list
            of subscribers is private.
          </p>
        </div>
      </section>
    </div>
  );
}
