'use strict';

export const CT_MIN = 0;       // exclusive lower bound
export const CT_MAX = 50;      // inclusive upper bound

/**
 * Parse a raw value into a validated Ct number.
 * Returns { valid: boolean, value: number | null }.
 *
 * Rules:
 * - Must be a finite number after coercion (Number()).
 * - Must be in (CT_MIN, CT_MAX] — that is 0 < Ct ≤ 50.
 * - null, undefined, '', NaN, Infinity, negative, zero, >50 all rejected.
 */
export function parseCt(value) {
  if (value === null || value === undefined) return { valid: false, value: null };
  const str = String(value).trim();
  if (str === '') return { valid: false, value: null };

  const num = Number(str);
  if (!Number.isFinite(num)) return { valid: false, value: null };
  if (num <= CT_MIN || num > CT_MAX) return { valid: false, value: null };

  return { valid: true, value: num };
}

/** Boolean check: is this value a valid Ct? */
export function isValidCt(value) {
  return parseCt(value).valid;
}

/**
 * Filter an array of raw Ct values, returning only the valid numeric ones.
 */
export function filterValidCts(cts) {
  if (!Array.isArray(cts)) return [];
  return cts
    .map(v => parseCt(v))
    .filter(r => r.valid)
    .map(r => r.value);
}
