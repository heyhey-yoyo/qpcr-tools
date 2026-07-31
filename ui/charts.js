'use strict';

/**
 * SVG chart generators for qPCR analysis results.
 * Pure functions: take data, return SVG string. No DOM access.
 */

import { mean } from '../core/statistics.js';
import { normalizeKey } from '../core/normalize.js';
import { escapeHtml } from '../core/escape.js';

export function fmt(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '') : '—';
}

export function truncateLabel(text, maxLen = 12) {
  const s = String(text || '');
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

/**
 * Per-sample bar chart with error bars.
 * @param {Array} items - result items with { name, group, gene, fold, foldLow, foldHigh, qc }
 * @returns {string} SVG markup
 */
export function resultsChartSvg(items) {
  const filtered = items.filter(item => Number.isFinite(item.fold));
  if (!filtered.length) return '';
  // 保持传入顺序（rows 顺序 = 区块表顺序），与孔板排版一致；不重新排序

  const maxNameLen = Math.max(...filtered.map(item => String(item.name || '').length), 4);
  const perItem = Math.max(76, Math.min(140, maxNameLen * 7 + 12));
  const barW = Math.max(40, perItem - 30);
  const width = Math.max(240, filtered.length * perItem + 16);
  const height = 210;
  const baseY = height - 34;
  const top = 14;
  const maxValue = Math.max(...filtered.map(item => (Number.isFinite(item.foldHigh) ? item.foldHigh : item.fold))) || 1;
  const scale = value => (baseY - top) * (value / maxValue);

  const bars = filtered.map((item, index) => {
    const x = 8 + index * perItem;
    const cx = x + barW / 2;
    const y = baseY - scale(item.fold);
    const hasError = Number.isFinite(item.foldLow) && Number.isFinite(item.foldHigh) && item.foldHigh > item.foldLow;
    const yHigh = hasError ? baseY - scale(item.foldHigh) : y;
    const yLow = hasError ? baseY - scale(item.foldLow) : y;
    const error = hasError
      ? `<line x1="${cx}" y1="${yHigh}" x2="${cx}" y2="${yLow}" stroke="#64748b" stroke-width="1.2"/>`
        + `<line x1="${cx - 6}" y1="${yHigh}" x2="${cx + 6}" y2="${yHigh}" stroke="#64748b" stroke-width="1.2"/>`
        + `<line x1="${cx - 6}" y1="${yLow}" x2="${cx + 6}" y2="${yLow}" stroke="#64748b" stroke-width="1.2"/>`
      : '';
    const color = item.qc ? '#0d9488' : '#b45309';
    const shortName = truncateLabel(item.name, 14);
    const shortGene = truncateLabel(item.gene, 12);
    return `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(1, baseY - y)}" rx="4" fill="${color}"/>`
      + error
      + `<text x="${cx}" y="${Math.max(10, yHigh - 5)}" text-anchor="middle" font-size="10" fill="#334155">${fmt(item.fold)}</text>`
      + `<text x="${cx}" y="${baseY + 14}" text-anchor="middle" font-size="9.5" fill="#64748b"><title>${escapeHtml(item.name)}</title>${escapeHtml(shortName)}</text>`
      + `<text x="${cx}" y="${baseY + 26}" text-anchor="middle" font-size="9.5" fill="#94a3b8"><title>${escapeHtml(item.gene)}</title>${escapeHtml(shortGene)}</text>`;
  }).join('');

  const axis = `<line x1="4" y1="${baseY}" x2="${width - 4}" y2="${baseY}" stroke="#cbd5e1" stroke-width="1"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" style="width:${width}px;max-width:none" role="img" aria-label="相对表达量柱状图（含误差棒）">${axis}${bars}</svg>`;
}

/**
 * Grouped bar chart (ΔΔCt mode only, multiple genes).
 * @param {Array} items - result items
 * @param {Array} geneOrder - ordered list of gene names
 * @returns {string} SVG markup
 */
export function groupChartSvg(items, geneOrder) {
  const valid = items.filter(item => Number.isFinite(item.ddct) && !item.missingControl);
  if (!valid.length) return '';

  const geneList = geneOrder && geneOrder.length
    ? geneOrder.filter(g => valid.some(item => normalizeKey(item.gene) === normalizeKey(g)))
    : [...new Set(valid.map(item => item.gene))];
  if (geneList.length <= 1) return ''; // single gene: individual chart is enough

  // 组簇顺序 = 结果中组首次出现顺序（与区块表/孔板排版一致）
  const groupList = [...new Set(valid.map(item => item.group))];

  const byKey = new Map();
  valid.forEach(item => {
    const key = `${normalizeKey(item.gene)}|||${normalizeKey(item.group)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item.ddct);
  });

  const colors = ['#0d9488', '#6366f1', '#d946ef', '#f59e0b', '#14b8a6', '#8b5cf6'];
  const barW = 32;
  const barGap = 4;
  const clusterGap = 20;
  const barH = 136;
  const topPad = 24;
  const chartH = 200;
  const baseY = topPad + barH;
  let maxFold = 1;
  const allBars = [];

  groupList.forEach(groupName => {
    geneList.forEach((geneName, gi) => {
      const key = `${normalizeKey(geneName)}|||${normalizeKey(groupName)}`;
      const ddcts = byKey.get(key) || [];
      if (!ddcts.length) return;
      const n = ddcts.length;
      const meanDdct = mean(ddcts);
      let semVal = 0;
      if (n > 1) {
        const v = ddcts.reduce((s, v) => s + (v - meanDdct) ** 2, 0) / (n - 1);
        semVal = Math.sqrt(v / n);
      }
      const fold = Math.pow(2, -meanDdct);
      const fLo = semVal ? Math.pow(2, -(meanDdct + semVal)) : fold;
      const fHi = semVal ? Math.pow(2, -(meanDdct - semVal)) : fold;
      maxFold = Math.max(maxFold, fHi);
      allBars.push({ group: groupName, gene: geneName, gi, n, fold, foldLow: fLo, foldHigh: fHi });
    });
  });

  if (!allBars.length) return '';

  const nGenes = geneList.length;
  const clusterW = nGenes * (barW + barGap) - barGap;
  const maxGroupLen = Math.max(...groupList.map(n => String(n).length), 4);
  const dynClusterGap = Math.max(clusterGap, maxGroupLen * 7 + 8);
  const totalW = Math.max(280, groupList.length * (clusterW + dynClusterGap) + 20);
  const scale = v => (barH - 4) * (v / maxFold);

  let svgParts = '';
  let offset = 14;
  groupList.forEach(groupName => {
    const bars = allBars.filter(b => b.group === groupName);
    const cx = offset + clusterW / 2;
    const shortGroup = truncateLabel(groupName, 14);
    svgParts += `<text x="${cx}" y="${baseY + 14}" text-anchor="middle" font-size="9" fill="#475569" font-weight="600"><title>${escapeHtml(groupName)}</title>${escapeHtml(shortGroup)}</text>`;
    bars.forEach(b => {
      const x = offset + b.gi * (barW + barGap);
      const y = baseY - scale(b.fold);
      const hasErr = b.foldHigh > b.foldLow;
      const yHi = hasErr ? baseY - scale(b.foldHigh) : y;
      const yLo = hasErr ? baseY - scale(b.foldLow) : y;
      const color = colors[b.gi % colors.length];
      svgParts += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(1, baseY - y)}" rx="3" fill="${color}" fill-opacity="0.85"/>`;
      if (hasErr) {
        const mx = x + barW / 2;
        svgParts += `<line x1="${mx}" y1="${yHi}" x2="${mx}" y2="${yLo}" stroke="#475569" stroke-width="1"/>`
          + `<line x1="${mx - 4}" y1="${yHi}" x2="${mx + 4}" y2="${yHi}" stroke="#475569" stroke-width="1"/>`
          + `<line x1="${mx - 4}" y1="${yLo}" x2="${mx + 4}" y2="${yLo}" stroke="#475569" stroke-width="1"/>`;
      }
      svgParts += `<text x="${x + barW / 2}" y="${Math.max(16, yHi - 3)}" text-anchor="middle" font-size="8.5" fill="#334155">${fmt(b.fold)}</text>`;
    });
    offset += clusterW + dynClusterGap;
  });

  svgParts += `<line x1="4" y1="${baseY}" x2="${totalW - 4}" y2="${baseY}" stroke="#cbd5e1" stroke-width="1"/>`;
  svgParts += geneList.map((g, i) =>
    `<rect x="${8 + i * 80}" y="4" width="10" height="10" rx="2" fill="${colors[i % colors.length]}" fill-opacity="0.85"/>`
    + `<text x="${22 + i * 80}" y="13" font-size="9" fill="#475569">${escapeHtml(g)}</text>`
  ).join('');

  return `<svg viewBox="0 0 ${totalW} ${chartH}" style="width:${totalW}px;max-width:none" role="img" aria-label="分组汇总柱状图">${svgParts}</svg>`;
}
