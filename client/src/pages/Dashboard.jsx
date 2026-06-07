import { useEffect, useState } from 'react';
import { api } from '../api.js';
import SummaryCard from '../components/SummaryCard.jsx';
import CrossSourceAnalysis from '../components/CrossSourceAnalysis.jsx';

export default function Dashboard() {
  const [items, setItems] = useState([]);
  const [report, setReport] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getNews();
      setItems(data.items || []);
      setReport(data.report || null);
      setLastUpdated(data.lastUpdated);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError('');
    try {
      const data = await api.refresh();
      setItems(data.items || []);
      setReport(data.report || null);
      setLastUpdated(data.lastUpdated);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {lastUpdated
              ? `Last updated ${new Date(lastUpdated).toLocaleString()}`
              : 'No data yet'}
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing || loading} className="btn btn-accent">
          <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {refreshing && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-3 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200"
        >
          <span className="animate-spin">⏳</span>
          <span>
            Refreshing… fetching the latest articles and re-summarizing every source with the LLM.
            This can take a minute or two — please keep this page open.
          </span>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500 dark:border-slate-700">
          No sources configured. Add some on the{' '}
          <a href="/settings" className="text-indigo-600 hover:underline">
            Settings
          </a>{' '}
          page.
        </div>
      ) : (
        <>
          <CrossSourceAnalysis report={report} />

          <h2 className="mb-4 text-xl font-bold">Single Source Analysis</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {items.map((item) => (
              <SummaryCard key={item.sourceName} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
