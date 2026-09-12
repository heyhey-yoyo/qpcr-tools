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

  const maxNameLen = Math.max(...filtered.flatMap(item => [String(item.name || '').length, String(item.gene || '').length]), 4);
  const perItem = Math.max(112, Math.min(192, maxNameLen * 12 + 24));
  const barW = Math.max(40, perItem - 30);
  const width = Math.max(240, filtered.length * perItem + 16);
  const height = 210;
  const baseY = height - 40;
  const top = 20;
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
      ? `<line x1="${cx}" y1="${yHigh}" x2="${cx}" y2="${yLow}" stroke="var(--chart-muted)" stroke-width="1.2"/>`
        + `<line x1="${cx - 6}" y1="${yHigh}" x2="${cx + 6}" y2="${yHigh}" stroke="var(--chart-muted)" stroke-width="1.2"/>`
        + `<line x1="${cx - 6}" y1="${yLow}" x2="${cx + 6}" y2="${yLow}" stroke="var(--chart-muted)" stroke-width="1.2"/>`
      : '';
    const color = item.qc ? 'var(--chart-ok)' : 'var(--chart-warning)';
    const shortName = truncateLabel(item.name, 14);
    const shortGene = truncateLabel(item.gene, 12);
    return `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(1, baseY - y)}" rx="4" fill="${color}"/>`
      + error
      + `<text x="${cx}" y="${Math.max(10, yHigh - 5)}" text-anchor="middle" font-size="12" fill="var(--chart-ink)">${fmt(item.fold)}</text>`
      + `<text x="${cx}" y="${baseY + 14}" text-anchor="middle" font-size="12" fill="var(--chart-muted)"><title>${escapeHtml(item.name)}</title>${escapeHtml(shortName)}</text>`
      + `<text x="${cx}" y="${baseY + 26}" text-anchor="middle" font-size="12" fill="var(--chart-muted)"><title>${escapeHtml(item.gene)}</title>${escapeHtml(shortGene)}</text>`;
  }).join('');

  const axis = `<line x1="4" y1="${baseY}" x2="${width - 4}" y2="${baseY}" stroke="var(--chart-line)" stroke-width="1"/>`;
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

  // 同色系用明度和纹理共同区分，图例与柱体共享同一编码。
  const colors = Array.from({ length: 6 }, (_, i) => `var(--chart-series-${i + 1})`);
  const marks = ['', '<path d="M0 8 8 0"/>', '<path d="M0 4h8"/>', '<circle cx="4" cy="4" r="1"/>', '<path d="M4 0v8"/>', '<path d="M0 4h8M4 0v8"/>'];
  const patterns = colors.map((color, i) => `<pattern id="qpcr-series-${i}" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="${color}"/><g stroke="var(--chart-ink)" fill="var(--chart-ink)" stroke-opacity=".35" fill-opacity=".35" stroke-width=".8">${marks[i]}</g></pattern>`).join('');
  const barW = 44;
  const barGap = 8;
  const clusterGap = 20;
  const barH = 136;
  const topPad = 32;
  const chartH = 208;
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
  const legendWidths = geneList.map(g => Math.min(16, String(g).length) * 12 + 36);
  const totalW = Math.max(280, groupList.length * (clusterW + dynClusterGap) + 20, legendWidths.reduce((a, b) => a + b, 16));
  const scale = v => (barH - 4) * (v / maxFold);

  let svgParts = '';
  let offset = 14;
  groupList.forEach(groupName => {
    const bars = allBars.filter(b => b.group === groupName);
    const cx = offset + clusterW / 2;
    const shortGroup = truncateLabel(groupName, 14);
    svgParts += `<text x="${cx}" y="${baseY + 14}" text-anchor="middle" font-size="12" fill="var(--chart-muted)" font-weight="600"><title>${escapeHtml(groupName)}</title>${escapeHtml(shortGroup)}</text>`;
    bars.forEach(b => {
      const x = offset + b.gi * (barW + barGap);
      const y = baseY - scale(b.fold);
      const hasErr = b.foldHigh > b.foldLow;
      const yHi = hasErr ? baseY - scale(b.foldHigh) : y;
      const yLo = hasErr ? baseY - scale(b.foldLow) : y;
      const color = `url(#qpcr-series-${b.gi % colors.length})`;
      svgParts += `<text x="${x + barW / 2}" y="${baseY + 29}" text-anchor="middle" font-size="12" fill="var(--chart-muted)"><title>${escapeHtml(b.gene)}</title>${escapeHtml(truncateLabel(b.gene, 4))}</text>`;
      svgParts += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(1, baseY - y)}" rx="0" fill="${color}"><title>${escapeHtml(b.group)} · ${escapeHtml(b.gene)}：${fmt(b.fold)}</title></rect>`;
      if (hasErr) {
        const mx = x + barW / 2;
        svgParts += `<line x1="${mx}" y1="${yHi}" x2="${mx}" y2="${yLo}" stroke="var(--chart-muted)" stroke-width="1"/>`
          + `<line x1="${mx - 4}" y1="${yHi}" x2="${mx + 4}" y2="${yHi}" stroke="var(--chart-muted)" stroke-width="1"/>`
          + `<line x1="${mx - 4}" y1="${yLo}" x2="${mx + 4}" y2="${yLo}" stroke="var(--chart-muted)" stroke-width="1"/>`;
      }
      svgParts += `<text x="${x + barW / 2}" y="${Math.max(16, yHi - 3)}" text-anchor="middle" font-size="12" fill="var(--chart-ink)">${fmt(b.fold)}</text>`;
    });
    offset += clusterW + dynClusterGap;
  });

  svgParts += `<line x1="4" y1="${baseY}" x2="${totalW - 4}" y2="${baseY}" stroke="var(--chart-line)" stroke-width="1"/>`;
  let legendX = 8;
  svgParts += geneList.map((g, i) => {
    const x = legendX;
    legendX += legendWidths[i];
    return `<rect x="${x}" y="4" width="14" height="14" fill="url(#qpcr-series-${i % colors.length})"/>`
      + `<text x="${x + 20}" y="16" font-size="12" fill="var(--chart-muted)"><title>${escapeHtml(g)}</title>${escapeHtml(truncateLabel(g, 16))}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${totalW} ${chartH}" style="width:${totalW}px;max-width:none" role="img" aria-label="分组汇总柱状图，基因用颜色、纹理和文字图例共同区分"><defs>${patterns}</defs>${svgParts}</svg>`;
}
