'use strict';

/**
 * Sliding-window rate limiter.
 *
 * Guarantees that no more than `max` calls to acquire() proceed within any
 * rolling `windowMs` period. Every actual LLM request (first attempt AND each
 * retry) must await acquire() first, so bursts and retries together can never
 * exceed the provider's requests-per-minute limit.
 *
 * Default: 5 requests / 60s — matches the Gemini 2.5 Flash free-tier RPM cap.
 */
class SlidingWindowRateLimiter {
  constructor(max, windowMs) {
    this.max = Math.max(1, max);
    this.windowMs = windowMs;
    this.timestamps = []; // start times of recent acquisitions
    this.chain = Promise.resolve(); // serializes acquire() so slots aren't double-counted
  }

  async acquire() {
    // Serialize entry so concurrent callers reserve slots one at a time.
    const run = this.chain.then(() => this._reserve());
    // Keep the chain from rejecting the whole queue on an unexpected error.
    this.chain = run.catch(() => {});
    return run;
  }

  async _reserve() {
    // Drop timestamps that have aged out of the window, then either take a
    // slot immediately or sleep until the oldest in-window call expires.
    // Loop because after sleeping, more callers may have arrived.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
      if (this.timestamps.length < this.max) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 25; // small buffer
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  /** Approximate seconds until a slot is free (0 if one is available now). */
  etaSeconds() {
    const now = Date.now();
    const live = this.timestamps.filter((t) => now - t < this.windowMs);
    if (live.length < this.max) return 0;
    return Math.ceil((this.windowMs - (now - live[0])) / 1000);
  }
}

// Shared singleton used by every LLM request. Configurable via env.
const MAX_RPM = Number(process.env.LLM_MAX_RPM) || 5;
const llmRateLimiter = new SlidingWindowRateLimiter(MAX_RPM, 60_000);

module.exports = { SlidingWindowRateLimiter, llmRateLimiter, MAX_RPM };
