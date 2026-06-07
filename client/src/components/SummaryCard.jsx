function faviconFor(url) {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return null;
  }
}

// Renders one source's analysis: an executive summary (no links) followed by up
// to three themes, each with a Topic Overview, Why It Matters, and a single Link.
export default function SummaryCard({ item }) {
  const favicon = faviconFor(item.sourceUrl);
  const themes = item.themes || [];
  const hasError = Boolean(item.error) && themes.length === 0;

  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center gap-3">
        {favicon ? (
          <img
            src={favicon}
            alt=""
            className="h-7 w-7 rounded"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <span className="text-xl">📰</span>
        )}
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{item.sourceName}</h3>
        </div>
      </div>

      {hasError ? (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          ⚠ {item.error}
        </div>
      ) : (
        <>
          {item.error && (
            <div className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              {item.error}
            </div>
          )}

          {item.executiveSummary && (
            <div className="mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Executive Summary
              </p>
              <p className="mt-1 break-words text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {item.executiveSummary}
              </p>
            </div>
          )}

          {themes.length > 0 ? (
            <div className="space-y-4">
              {themes.map((theme, i) => (
                <div key={i} className="border-t border-slate-100 pt-3 dark:border-slate-800">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Theme {i + 1}: {theme.name}
                  </h4>
                  {theme.topicOverview && (
                    <p className="mt-1 break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {theme.topicOverview}
                    </p>
                  )}
                  {theme.whyItMatters && (
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                        Why It Matters:{' '}
                      </span>
                      {theme.whyItMatters}
                    </p>
                  )}
                  {theme.link && (
                    <a
                      href={theme.link}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block truncate text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      title={theme.link}
                    >
                      ↗ {theme.link}
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">No analysis yet — hit Refresh.</p>
          )}
        </>
      )}

      {item.updatedAt && (
        <p className="mt-3 text-[11px] text-slate-400">
          Updated {new Date(item.updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
