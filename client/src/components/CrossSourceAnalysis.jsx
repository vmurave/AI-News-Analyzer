// Renders the Cross-Source Analysis section: an executive summary (no links)
// followed by up to three synthesized themes, each with source-cited evidence
// (links allowed here) and a "Why It Matters" rationale.
export default function CrossSourceAnalysis({ report }) {
  const themes = report?.themes || [];

  return (
    <section className="mb-8 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-6 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/30">
      <h2 className="text-xl font-bold text-indigo-900 dark:text-indigo-200">Cross-Source Analysis</h2>

      <div className="mt-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
          Executive Cross-Source Summary
        </h3>
        <p className="mt-2 leading-relaxed text-slate-700 dark:text-slate-200">
          {report?.executiveSummary ||
            'No cross-source patterns could be synthesized from the available sources yet — hit Refresh.'}
        </p>
      </div>

      {themes.map((theme, i) => (
        <div
          key={i}
          className="mt-5 border-t border-indigo-200/70 pt-4 dark:border-indigo-900/60"
        >
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            Theme {i + 1}: {theme.name}
          </h3>

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
            Evidence
          </p>
          <ul className="mt-1 space-y-2 text-sm">
            {(theme.evidence || []).map((e, j) => (
              <li key={j} className="text-slate-700 dark:text-slate-300">
                <span className="font-medium">{e.source}:</span> {e.topic}
                {e.link && (
                  <a
                    href={e.link}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 text-indigo-600 hover:underline dark:text-indigo-400"
                    title={e.link}
                    aria-label={`Open source: ${e.source}`}
                  >
                    ↗
                  </a>
                )}
              </li>
            ))}
          </ul>

          {theme.whyItMatters && (
            <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
              <span className="font-semibold text-indigo-700 dark:text-indigo-300">Why It Matters: </span>
              {theme.whyItMatters}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
