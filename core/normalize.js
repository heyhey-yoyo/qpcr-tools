'use strict';

/**
 * Normalize a string key for case-insensitive, whitespace-insensitive matching.
 * Used as fallback when stable IDs are not available (legacy data).
 */
export function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}
