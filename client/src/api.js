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
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.error || data.reason || `Request failed (${res.status})`);
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
