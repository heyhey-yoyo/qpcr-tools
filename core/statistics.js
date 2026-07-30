'use strict';

import { parseCt } from './ct.js';

/**
 * Arithmetic mean. Returns null for empty input.
 */
export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Sample standard deviation (Bessel-corrected, n-1 denominator).
 * Requires pre-computed mean. Returns 0 for n < 2.
 */
export function sd(values, avg) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  return Math.sqrt(
    values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1)
  );
}

/**
 * Standard error of the mean.
 */
export function sem(sdVal, n) {
  if (!Number.isFinite(sdVal) || n < 1) return null;
  return sdVal / Math.sqrt(n);
}

/**
 * Range (max - min). Returns 0 for n < 2.
 */
export function spread(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  return Math.max(...values) - Math.min(...values);
}

/**
 * Compute per-row statistics from Ct values.
 *
 * Uses parseCt() for unified validation: only values in (0, 50] are
 * included in the mean / SD / spread. Values outside this range are
 * treated as missing.
 *
 * Returns { mean, sd, spread, n } where n is count of valid Ct values.
 */
export function rowStats(cts) {
  if (!Array.isArray(cts)) return { mean: null, sd: 0, spread: 0, n: 0 };

  const valid = [];
  for (const raw of cts) {
    const parsed = parseCt(raw);
    if (parsed.valid) valid.push(parsed.value);
  }

  const avg = mean(valid);
  return {
    mean: avg,
    sd: valid.length > 1 ? sd(valid, avg) : 0,
    spread: spread(valid),
    n: valid.length
  };
}
