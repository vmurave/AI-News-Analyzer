// Thin API client. In dev, Vite proxies /api -> http://localhost:3000.
const BASE = '/api';

// Anonymous, per-browser identity. Used to scope a user's custom API key and
// their own generated summaries. It is NOT a secret (no key material) — just a
// random handle persisted in localStorage so the same browser is recognized.
function getClientId() {
  const KEY = 'ai-news-client-id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id =
        (crypto.randomUUID && crypto.randomUUID().replace(/-/g, '')) ||
        Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': getClientId(),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();

  // The body isn't always JSON: a serverless platform (e.g. Vercel) returns a
  // plain-text/HTML error page when a function times out or crashes. Parse
  // defensively so we surface a clear message instead of a JSON.parse error.
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }

  if (!res.ok) {
    const jsonMsg = data && (data.error || data.reason);
    if (jsonMsg) throw new Error(jsonMsg);
    if (res.status === 504 || res.status === 408) {
      throw new Error(
        'The request timed out — refreshing every source can take longer than the server allows. Please try again, or reduce the number of sources in Set up subscription.'
      );
    }
    throw new Error(`Request failed (${res.status}${res.statusText ? ' ' + res.statusText : ''}).`);
  }

  if (data === null) {
    throw new Error('The server returned an unexpected (non-JSON) response. Please try again in a moment.');
  }

  return data;
}

export const api = {
  getNews: () => request('/news'),
  refresh: () => request('/refresh', { method: 'POST', body: JSON.stringify({ force: true }) }),
  getSettings: () => request('/settings'),
  saveSettings: (settings) =>
    request('/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  resetSources: () => request('/settings/reset-sources', { method: 'POST' }),
  // Optionally pass an email to send a one-off digest without subscribing.
  sendDigest: (email) =>
    request('/refresh/send-digest', {
      method: 'POST',
      body: JSON.stringify(email ? { email } : {}),
    }),
  getSubscribers: () => request('/subscribers'),
  subscribe: (email, sources, topic) =>
    request('/subscribers', {
      method: 'POST',
      body: JSON.stringify({ email, sources, topic }),
    }),
  unsubscribe: (email) =>
    request(`/subscribers/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  getApiKey: () => request('/apikey'),
  saveApiKey: (apiKey) =>
    request('/apikey', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  removeApiKey: () => request('/apikey', { method: 'DELETE' }),
  health: () => request('/health'),
};
