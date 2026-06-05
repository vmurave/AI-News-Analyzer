'use strict';

/**
 * Assemble the final AI News Analysis Report as Markdown.
 *
 * The report follows a fixed structure (enforced by the content rules):
 *   # AI News Analysis Report
 *   # Cross-Source Analysis
 *     ## Executive Cross-Source Summary   (no links)
 *     ## Theme N: ...  -> ### Evidence (links here) + ### Why It Matters
 *   # Single Source Analysis
 *     ## <Source>      -> ### Executive Summary (no links)
 *                         ### Theme N: ... -> #### Topic Overview / Why It Matters / Link
 *
 * Links may only appear in cross-source Evidence and in each single-source
 * theme's Link section — never in any executive summary.
 *
 * @param {object} crossSource  { executiveSummary, themes[] }
 * @param {Array}  items        per-source results { sourceName, executiveSummary, themes[], error }
 * @returns {string} Markdown
 */
function buildReportMarkdown(crossSource = {}, items = []) {
  const lines = [];
  const push = (s = '') => lines.push(s);

  push('# AI News Analysis Report');
  push('');

  // ---- Cross-Source Analysis ----------------------------------------------
  push('# Cross-Source Analysis');
  push('');
  push('## Executive Cross-Source Summary');
  push('');
  push(
    crossSource.executiveSummary ||
      'No cross-source patterns could be synthesized from the available sources.'
  );
  push('');

  const crossThemes = crossSource.themes || [];
  crossThemes.forEach((theme, i) => {
    push('---');
    push('');
    push(`## Theme ${i + 1}: ${theme.name}`);
    push('');
    push('### Evidence');
    push('');
    (theme.evidence || []).forEach((e) => {
      push(`* ${e.source}: ${e.topic}`);
      if (e.link) push(`  [${e.link}](${e.link})`);
    });
    push('');
    push('### Why It Matters');
    push('');
    push(theme.whyItMatters || '');
    push('');
  });

  // ---- Single Source Analysis ---------------------------------------------
  push('# Single Source Analysis');
  push('');

  items.forEach((item) => {
    push(`## ${item.sourceName}`);
    push('');

    // A source that failed entirely still gets a heading + note, but no themes.
    if (item.error && (!item.themes || item.themes.length === 0)) {
      push('### Executive Summary');
      push('');
      push(`⚠ ${item.error}`);
      push('');
      return;
    }

    push('### Executive Summary');
    push('');
    push(item.executiveSummary || '');
    push('');

    (item.themes || []).forEach((theme, i) => {
      push('---');
      push('');
      push(`### Theme ${i + 1}: ${theme.name}`);
      push('');
      push('#### Topic Overview');
      push('');
      push(theme.topicOverview || '');
      push('');
      push('#### Why It Matters');
      push('');
      push(theme.whyItMatters || '');
      push('');
      push('#### Link');
      push('');
      if (theme.link) push(`[${theme.link}](${theme.link})`);
      push('');
    });
  });

  // Collapse 3+ blank lines and trim trailing whitespace.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

module.exports = { buildReportMarkdown };
