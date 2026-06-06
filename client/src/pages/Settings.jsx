import { useEffect, useState } from 'react';
import { api } from '../api.js';

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const label = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1';
const card =
  'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900';

export default function Settings() {
  const [s, setS] = useState(null);
  const [maxSources, setMaxSources] = useState(7);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null); // { type, msg }
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [subEmail, setSubEmail] = useState('');
  const [subBusy, setSubBusy] = useState(false);
  const [keyMeta, setKeyMeta] = useState({ hasKey: false, masked: '' });
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);

  function flash(type, msg, ms = 4000) {
    setToast({ type, msg });
    // ms <= 0 keeps the toast until the next flash (used for "sending…").
    if (ms > 0) setTimeout(() => setToast(null), ms);
  }

  async function load() {
    setLoading(true);
    try {
      const [data, subs, keyData] = await Promise.all([
        api.getSettings(),
        api.getSubscribers(),
        api.getApiKey(),
      ]);
      setMaxSources(data.maxSources || 7);
      setSubscriberCount(subs.count || 0);
      setKeyMeta({ hasKey: Boolean(keyData.hasKey), masked: keyData.masked || '' });
      setS({
        topicFilter: data.topicFilter || '',
        sources: data.sources || [],
      });
    } catch (e) {
      flash('error', e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveApiKey() {
    const apiKey = keyInput.trim();
    if (!apiKey) {
      flash('error', 'Please enter an API key before saving.');
      return;
    }
    setKeyBusy(true);
    try {
      const data = await api.saveApiKey(apiKey);
      setKeyMeta({ hasKey: Boolean(data.hasKey), masked: data.masked || '' });
      setKeyInput(''); // never keep the plaintext key around in the UI
      flash('success', data.message || 'Custom API key saved.');
    } catch (e) {
      flash('error', e.message);
    } finally {
      setKeyBusy(false);
    }
  }

  async function removeApiKey() {
    setKeyBusy(true);
    try {
      const data = await api.removeApiKey();
      setKeyMeta({ hasKey: false, masked: '' });
      setKeyInput('');
      flash('success', data.message || 'Custom API key removed.');
    } catch (e) {
      flash('error', e.message);
    } finally {
      setKeyBusy(false);
    }
  }

  async function subscribe() {
    const email = subEmail.trim();
    if (!email) return;
    setSubBusy(true);
    try {
      const data = await api.subscribe(email);
      if (data.count != null) setSubscriberCount(data.count);
      if (data.added) setSubEmail('');
      flash(data.added ? 'success' : 'error', data.message);
    } catch (e) {
      flash('error', e.message);
    } finally {
      setSubBusy(false);
    }
  }

  // Self-service unsubscribe: you remove your own address by typing it in.
  async function unsubscribe() {
    const email = subEmail.trim();
    if (!email) return;
    setSubBusy(true);
    try {
      const data = await api.unsubscribe(email);
      if (data.count != null) setSubscriberCount(data.count);
      setSubEmail('');
      flash('success', `Unsubscribed ${email}.`);
    } catch (e) {
      flash('error', e.message);
    } finally {
      setSubBusy(false);
    }
  }

  function update(field, value) {
    setS((prev) => ({ ...prev, [field]: value }));
  }

  function updateSource(i, key, value) {
    setS((prev) => {
      const sources = prev.sources.map((src, idx) =>
        idx === i ? { ...src, [key]: value } : src
      );
      return { ...prev, sources };
    });
  }

  function addSource() {
    setS((prev) => {
      if (prev.sources.length >= maxSources) return prev;
      return { ...prev, sources: [...prev.sources, { name: '', url: '' }] };
    });
  }

  function removeSource(i) {
    setS((prev) => ({ ...prev, sources: prev.sources.filter((_, idx) => idx !== i) }));
  }

  async function resetSources() {
    try {
      const data = await api.resetSources();
      setS((prev) => ({ ...prev, sources: data.sources }));
      flash('success', 'Sources reset to defaults.');
    } catch (e) {
      flash('error', e.message);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        topicFilter: s.topicFilter,
        sources: s.sources.filter((src) => src.name.trim() && src.url.trim()),
      };
      const data = await api.saveSettings(payload);
      setS((prev) => ({ ...prev, sources: data.sources }));
      flash('success', 'Settings saved.');
    } catch (e) {
      flash('error', e.message);
    } finally {
      setSaving(false);
    }
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

  if (loading || !s) {
    return <div className="text-slate-500">Loading settings…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Settings</h2>
        <button onClick={save} disabled={saving} className="btn btn-accent">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {toast && (
        <div
          className={`rounded-lg p-3 text-sm ${
            toast.type === 'error'
              ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* News sources */}
      <section className={card}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">News Sources</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {s.sources.length}/{maxSources} sources
            </p>
          </div>
          <button onClick={resetSources} className="btn btn-ghost">
            Reset to defaults
          </button>
        </div>

        <div className="space-y-3">
          {s.sources.map((src, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                className={`${input} sm:w-44`}
                placeholder="Name"
                value={src.name}
                onChange={(e) => updateSource(i, 'name', e.target.value)}
              />
              <input
                className={`${input} flex-1 min-w-[200px]`}
                placeholder="https://example.com/ai"
                value={src.url}
                onChange={(e) => updateSource(i, 'url', e.target.value)}
              />
              <button onClick={() => removeSource(i)} className="btn btn-danger" title="Remove source">
                ✕
              </button>
            </div>
          ))}
        </div>

        <button onClick={addSource} disabled={s.sources.length >= maxSources} className="btn btn-ghost mt-4">
          + Add source
        </button>
      </section>

      {/* Daily digest subscription */}
      <section className={card}>
        <h3 className="text-lg font-semibold">Daily Digest Subscription</h3>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Enter your email and subscribe to receive the daily AI news summary at 8:00 AM.
        </p>

        <div>
          <label className={label}>Your email</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} flex-1 min-w-[220px]`}
              type="email"
              placeholder="you@example.com"
              value={subEmail}
              onChange={(e) => setSubEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendTestDigest()}
            />
            <button
              onClick={sendTestDigest}
              disabled={digestBusy || (subscriberCount === 0 && !subEmail.trim())}
              className="btn btn-ghost"
            >
              {digestBusy ? 'Sending…' : '✉ Send digest'}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {subEmail.trim()
              ? `Sends a one-off digest to ${subEmail.trim()} without subscribing.`
              : 'Sends to all subscribers. Type an email above to send a one-off digest without subscribing.'}
          </p>
        </div>

        {/* Privacy: only the count is shown — the subscriber email list is never exposed. */}
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          {subscriberCount === 0
            ? 'No subscribers yet.'
            : `${subscriberCount} subscriber${subscriberCount === 1 ? '' : 's'} on the daily digest list.`}
        </p>

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <label className={label}>Topic / keyword filter (optional)</label>
          <input
            className={input}
            placeholder="e.g. LLM, robotics, image generation"
            value={s.topicFilter}
            onChange={(e) => update('topicFilter', e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">
            Applies to the report and the digest. Remember to Save after changing it.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={subscribe} disabled={subBusy || !subEmail.trim()} className="btn btn-accent">
            {subBusy ? 'Working…' : 'Subscribe'}
          </button>
          <button onClick={unsubscribe} disabled={subBusy || !subEmail.trim()} className="btn btn-danger">
            Unsubscribe
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Subscribe or unsubscribe the email typed above. The list of subscribers is private.
        </p>
      </section>

      {/* Custom API key (per-browser, optional) */}
      <section className={card}>
        <h3 className="text-lg font-semibold">Custom API Key (Optional)</h3>

        <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          <p>
            This dashboard uses a <strong>shared Gemini API key</strong> with a daily token limit. If
            the shared quota is exceeded, summaries may not be generated.
          </p>
          <p>
            You can add <strong>your own API key</strong> to avoid hitting the shared limit. Your
            saved key is used <strong>only for your own dashboard requests</strong>.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Your key is encrypted at rest and never shown again after saving — only a masked version is
            displayed. It is never exposed in API responses, logs, or your browser storage.
          </p>
        </div>

        {keyMeta.hasKey && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <span className="text-emerald-700 dark:text-emerald-300">
              A custom key is active: <span className="font-mono">{keyMeta.masked}</span>
            </span>
            <button onClick={removeApiKey} disabled={keyBusy} className="btn btn-danger">
              Remove key
            </button>
          </div>
        )}

        <div className="mt-4">
          <label className={label}>{keyMeta.hasKey ? 'Replace API key' : 'Your API key'}</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} flex-1 min-w-[220px]`}
              type="password"
              autoComplete="off"
              placeholder={keyMeta.hasKey ? 'Enter a new key to replace the saved one' : 'Paste your API key'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveApiKey()}
            />
            <button onClick={saveApiKey} disabled={keyBusy || !keyInput.trim()} className="btn btn-accent">
              {keyBusy ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            If your personal key is invalid, expired, or out of quota, your summaries will show a clear
            error — the dashboard will not silently fall back to the shared key.
          </p>
        </div>
      </section>
    </div>
  );
}
