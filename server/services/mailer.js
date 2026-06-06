'use strict';

const nodemailer = require('nodemailer');
const db = require('../db');

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465, // SSL on 465, STARTTLS otherwise
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- HTML fragment builders (mirror the report structure) -----------------

function renderCrossSourceHtml(report = {}) {
  const summary = report.executiveSummary
    ? escapeHtml(report.executiveSummary)
    : 'No cross-source patterns could be synthesized from the available sources.';

  const themes = (report.themes || [])
    .map((t, i) => {
      const evidence = (t.evidence || [])
        .map(
          (e) =>
            `<li style="margin:6px 0;color:#374151;"><strong>${escapeHtml(e.source)}:</strong> ${escapeHtml(
              e.topic
            )}${
              e.link
                ? `<br/><a href="${escapeHtml(e.link)}" style="color:#2563eb;text-decoration:none;font-size:13px;">↗ ${escapeHtml(
                    e.link
                  )}</a>`
                : ''
            }</li>`
        )
        .join('');
      return `
      <div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:12px;">
        <h3 style="margin:0 0 8px;font-size:16px;color:#111827;">Theme ${i + 1}: ${escapeHtml(t.name)}</h3>
        <p style="margin:0 0 4px;font-weight:600;color:#4338ca;font-size:13px;">Evidence</p>
        <ul style="margin:0 0 10px;padding-left:20px;">${evidence}</ul>
        ${
          t.whyItMatters
            ? `<p style="margin:0;color:#374151;font-size:14px;"><strong>Why It Matters:</strong> ${escapeHtml(
                t.whyItMatters
              )}</p>`
            : ''
        }
      </div>`;
    })
    .join('');

  return `
  <div style="border:1px solid #c7d2fe;background:#eef2ff;border-radius:12px;padding:18px;margin:0 0 20px;">
    <h2 style="margin:0 0 10px;font-size:20px;color:#312e81;">Cross-Source Analysis</h2>
    <p style="margin:0 0 6px;font-weight:600;color:#4338ca;">Executive Cross-Source Summary</p>
    <p style="margin:0;color:#374151;line-height:1.5;">${summary}</p>
    ${themes}
  </div>`;
}

function renderSourceHtml(s) {
  if (s.error && (!s.themes || s.themes.length === 0)) {
    return `
    <div style="border:1px solid #fecaca;background:#fef2f2;border-radius:10px;padding:16px;margin:0 0 16px;">
      <h2 style="margin:0 0 6px;font-size:18px;color:#111827;">${escapeHtml(s.sourceName)}</h2>
      <p style="margin:0;color:#b91c1c;">⚠ ${escapeHtml(s.error)}</p>
    </div>`;
  }

  const notice = s.error
    ? `<p style="margin:0 0 10px;padding:6px 10px;background:#fffbeb;border-radius:8px;color:#92400e;font-size:12px;">${escapeHtml(
        s.error
      )}</p>`
    : '';

  const exec = s.executiveSummary
    ? `<p style="margin:0 0 12px;color:#374151;line-height:1.5;font-size:14px;">${escapeHtml(s.executiveSummary)}</p>`
    : '';

  const themes = (s.themes || [])
    .map((t, i) => {
      return `
      <div style="border-top:1px solid #f3f4f6;padding-top:12px;margin-top:12px;">
        <h3 style="margin:0 0 6px;font-size:15px;color:#111827;">Theme ${i + 1}: ${escapeHtml(t.name)}</h3>
        ${
          t.topicOverview
            ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;line-height:1.5;">${escapeHtml(
                t.topicOverview
              )}</p>`
            : ''
        }
        ${
          t.whyItMatters
            ? `<p style="margin:0 0 8px;color:#374151;font-size:13px;"><strong>Why It Matters:</strong> ${escapeHtml(
                t.whyItMatters
              )}</p>`
            : ''
        }
        ${
          t.link
            ? `<a href="${escapeHtml(t.link)}" style="color:#2563eb;text-decoration:none;font-size:13px;">↗ ${escapeHtml(
                t.link
              )}</a>`
            : ''
        }
      </div>`;
    })
    .join('');

  return `
  <div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:0 0 16px;">
    <h2 style="margin:0 0 8px;font-size:18px;color:#111827;">${escapeHtml(s.sourceName)}</h2>
    ${notice}
    ${exec}
    ${themes}
  </div>`;
}

function renderDigestHtml(summaries, report, settings) {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const topic = settings.topicFilter
    ? `<p style="color:#6b7280;margin:0 0 16px;">Topic filter: <strong>${escapeHtml(settings.topicFilter)}</strong></p>`
    : '';

  const single = (summaries || []).map(renderSourceHtml).join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;padding:24px;background:#f9fafb;">
    <h1 style="font-size:24px;color:#111827;margin:0 0 4px;">🤖 AI News Analysis Report</h1>
    <p style="color:#6b7280;margin:0 0 12px;">${date}</p>
    ${topic}
    ${renderCrossSourceHtml(report)}
    <h2 style="font-size:20px;color:#111827;margin:0 0 12px;">Single Source Analysis</h2>
    ${single}
    <p style="color:#9ca3af;font-size:12px;margin-top:24px;text-align:center;">
      Generated by AI News Analyzer.
    </p>
  </div>`;
}

/**
 * Send the daily digest email to all subscribers. Resolves with a status
 * object; never throws.
 * @param {Array}  summaries    per-source results
 * @param {object} report       cross-source report { executiveSummary, themes }
 * @param {object} settings
 * @param {string[]} recipients  subscriber email addresses
 */
async function sendDigest(summaries, report, settings, recipients = []) {
  const list = (recipients || []).map((e) => String(e).trim()).filter(Boolean);
  if (list.length === 0) {
    return { sent: false, reason: 'No subscribers yet — add one in Settings to receive the digest.' };
  }
  if (!hasSmtpConfig()) {
    return { sent: false, reason: 'SMTP is not configured (set SMTP_HOST/SMTP_USER/SMTP_PASS in .env).' };
  }

  try {
    const transport = createTransport();
    const html = renderDigestHtml(summaries, report, settings);
    const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
    const info = await transport.sendMail({
      from,
      // Send to the sender and BCC subscribers so recipients can't see each other.
      to: from,
      bcc: list,
      subject: `🤖 AI News Digest — ${new Date().toLocaleDateString('en-US')}`,
      html,
    });
    return { sent: true, messageId: info.messageId, recipients: list.length };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

/**
 * Notify the digest admin (EMAIL_FROM / SMTP_USER, i.e. the configured sender
 * inbox) that someone subscribed — including the email and the sources they
 * chose. Best-effort; never throws.
 * @param {object} sub  { email, sources: [{name,url}], topic }
 */
async function sendSubscriptionNotice({ email, sources = [], topic = '' } = {}) {
  const admin = process.env.EMAIL_FROM || process.env.SMTP_USER;
  if (!admin) return { sent: false, reason: 'No admin address configured.' };
  if (!hasSmtpConfig()) {
    return { sent: false, reason: 'SMTP is not configured.' };
  }
  try {
    const transport = createTransport();
    const list =
      (sources || [])
        .filter((s) => s && s.name && s.url)
        .map(
          (s) =>
            `<li style="margin:4px 0;">${escapeHtml(s.name)} — <a href="${escapeHtml(
              s.url
            )}">${escapeHtml(s.url)}</a></li>`
        )
        .join('') || '<li>(no sources specified)</li>';

    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;">
      <h2 style="color:#111827;">📬 New daily-digest subscription</h2>
      <p style="margin:0 0 6px;"><strong>Subscriber:</strong> ${escapeHtml(email)}</p>
      <p style="margin:0 0 6px;"><strong>Topic filter:</strong> ${escapeHtml(topic || '(none)')}</p>
      <p style="margin:12px 0 4px;"><strong>Requested sources:</strong></p>
      <ul style="margin:0;padding-left:20px;color:#374151;">${list}</ul>
    </div>`;

    const info = await transport.sendMail({
      from: admin,
      to: admin,
      subject: `New subscription: ${email}`,
      html,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendDigest, renderDigestHtml, hasSmtpConfig, sendSubscriptionNotice };
