'use strict';

import { parseCt, isValidCt } from '../core/ct.js';
import { normalizeKey } from '../core/normalize.js';

/**
 * Parse Roche single-column Ct/Cp/Cq output.
 *
 * Handles:
 *   - BOM (﻿)
 *   - Header lines (Ct, Cp, Cq, Crossing Point, etc.)
 *   - Missing value indicators (Undetermined, No Ct, N/A, etc.)
 *   - Comma-as-decimal (European locale) → converted to dot
 *   - Well IDs (A1, B2, ...) → skipped
 *   - Numeric extraction from mixed text
 *
 * All extracted numeric values are validated through parseCt().
 * Values outside (0, 50] are treated as invalid/missing.
 *
 * @param {string} text - raw clipboard text
 * @returns {{ values: Array<number|null>, numeric: number, skipped: number }}
 *   values: array where valid Ct numbers are stored, null for invalid/missing
 *   numeric: count of valid Ct values found
 *   skipped: count of skipped (header/missing/non-Ct) lines
 */
export function parseCtColumn(text) {
  const lines = String(text ?? '').replaceAll('﻿', '').replaceAll('\r', '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  const values = [];
  let skipped = 0;
  let numeric = 0;

  const headerPattern = /^(ct|cq|cp|ct\s*value|cq\s*value|crossing\s*point|crossingpoint|cycle|value|ct值|cq值|cp值|结果)$/i;
  const missingPattern = /^(undetermined|undefined|no\s*cq|no\s*ct|no\s*cp|n\/a|na|nan|null|failed|invalid|—|–|-)$/i;

  lines.forEach(rawLine => {
    const cell = rawLine.split('\t')[0].trim().replace(/^"|"$/g, '');
    if (!cell) {
      values.push(null);
      return;
    }
    if (headerPattern.test(cell)) {
      skipped += 1;
      return;
    }
    if (missingPattern.test(cell)) {
      values.push(null);
      return;
    }

    // Try exact number match (comma → dot)
    const normalized = cell.replace(/，/g, ',').replace(',', '.');
    const exact = normalized.match(/^-?\d+(?:\.\d+)?$/);
    if (exact) {
      const parsed = parseCt(Number(exact[0]));
      if (parsed.valid) {
        values.push(parsed.value);
        numeric += 1;
      } else {
        values.push(null); // out of range
      }
      return;
    }

    // Skip well IDs like A1, H12
    if (/^[A-P]\d{1,2}$/i.test(normalized)) {
      skipped += 1;
      return;
    }

    // Try to extract a number from mixed text
    const tokens = normalized.match(/-?\d+(?:\.\d+)?/g) || [];
    const candidate = tokens.length ? Number(tokens[tokens.length - 1]) : NaN;
    const hasDecimal = tokens.some(token => token.includes('.'));
    const hasCtContext = /(ct|cq|cp|crossing)/i.test(normalized);
    const hasLetters = /[a-z]/i.test(normalized);

    if (Number.isFinite(candidate) && candidate >= 0 && candidate <= 60 && (!hasLetters || hasDecimal || hasCtContext || tokens.length > 1)) {
      const parsed = parseCt(candidate);
      if (parsed.valid) {
        values.push(parsed.value);
        numeric += 1;
      } else {
        values.push(null);
      }
      return;
    }
    skipped += 1;
  });

  return { values, numeric, skipped };
}

/**
 * Parse a full table paste (tab or comma separated).
 * Lines must have at least 4 columns after optional well column.
 * Ct values are validated through parseCt().
 *
 * @param {string} text - raw pasted text
 * @param {Object} plate - plate config { rows, cols }
 * @param {number} replicateCount - expected number of replicates per row
 * @returns {Array} rows with { wells, name, group, gene, cts }
 */
export function parseFullTable(text, plate, replicateCount) {
  return String(text).trim().split(/\n/)
    .map(line => line.replace(/\r$/, '').split(/\t|,/))
    .filter(parts => parts.length >= 4)
    .map(parts => {
      const first = parts[0].trim();
      const wells = first.split(/[,，;\s]+/).map(value => value.trim().toUpperCase()).filter(Boolean);
      const hasWellColumn = wells.length > 0 && wells.every(well => {
        const match = well.match(/^([A-P])(\d{1,2})$/);
        return match && plate.rows.includes(match[1]) && Number(match[2]) >= 1 && Number(match[2]) <= plate.cols;
      });
      const offset = hasWellColumn ? 1 : 0;
      if (parts.length < 4 + offset) return null;

      const rawCts = parts.slice(3 + offset).map(value => value.trim()).slice(0, replicateCount);
      // Validate each Ct through parseCt
      const cts = rawCts.map(v => {
        const parsed = parseCt(v);
        return parsed.valid ? String(parsed.value) : '';
      });

      return {
        wells: hasWellColumn ? wells : Array(Math.max(replicateCount, cts.length)).fill(''),
        name: parts[offset].trim(),
        group: parts[offset + 1].trim(),
        gene: parts[offset + 2].trim(),
        cts: cts.length ? cts : Array(replicateCount).fill('')
      };
    }).filter(Boolean);
}

/**
 * Import template from parsed JSON data.
 * Handles version 1-4 template formats.
 *
 * @param {Object} data - parsed JSON
 * @returns {{ blocks: Array, experiment: Object|null, replicateCount: number }|null}
 */
export function importTemplateData(data) {
  const list = Array.isArray(data) ? data : data?.blocks;
  if (!Array.isArray(list) || !list.length) return null;

  return {
    blocks: list,
    experiment: data.experiment || null,
    replicateCount: data.replicateCount,
    version: data.version || 1
  };
}
