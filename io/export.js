'use strict';

import { fmt } from '../ui/charts.js';

/**
 * Quote a CSV cell value. Wraps in double quotes if the value contains
 * commas, double quotes, or newlines. Guards against spreadsheet formula
 * injection: non-numeric text starting with = + - @ (or tab/CR) is prefixed
 * with a single quote so Excel treats it as text.
 */
export function csvCell(value) {
  const text = String(value ?? '');
  // 合法数字字符串（含负数如 "-2.35"）保持原样，不转文本
  const isNumericString = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text);
  const safe = !isNumericString && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * Generate results CSV content with BOM.
 * Error type column explicitly labels the error as technical replicate SEM.
 */
export function resultsCsv(results, mode) {
  const header = [
    '样本', '组别', '目标基因', '比较基准',
    '目标Ct', '内参Ct', 'DeltaCt',
    '比较基准平均ΔCt', '比较基准N', 'DeltaDeltaCt',
    '相对表达量',
    '误差类型', 'ΔCt SEM（技术重复，不含比较基准平均误差）',
    'Fold下限', 'Fold上限', '质控'
  ].map(csvCell).join(',');

  const rows = results.map(item => {
    const errorType = item.missingControl ? '—'
      : item.errorType === 'techSem' ? '技术重复SEM（ΔCt层面）'
      : item.n < 2 ? '单孔'
      : '—';

    return [
      item.name, item.group, item.gene,
      mode === 'ddct' ? (item.compareToGroup || '—') : '—',
      fmt(item.targetCt), fmt(item.referenceCt), fmt(item.dct),
      fmt(item.controlMean), item.controlN ?? '',
      mode === 'ddct' ? fmt(item.ddct) : '—',
      fmt(item.fold),
      errorType,
      Number.isFinite(item.error) ? fmt(item.error) : '—',
      fmt(item.foldLow), fmt(item.foldHigh),
      item.missingControl ? '缺对照' : item.n < 2 ? '单孔' : item.qc ? '通过' : '需复核'
    ].map(csvCell).join(',');
  });

  return [header, ...rows].join('\n');
}

/**
 * Generate plate layout CSV.
 */
export function plateCsv(placements, plateSize) {
  const header = ['孔板规格', '孔位', '样本', '组别', '基因', '类型', '技术重复序号'].map(csvCell).join(',');
  const rows = placements.map(item => [
    plateSize, item.well, item.sample, item.group, item.gene,
    item.role === 'reference' ? '内参' : '目标', item.rep
  ].map(csvCell).join(','));
  return [header, ...rows].join('\n');
}

/**
 * Trigger a file download in the browser.
 * @param {string} filename
 * @param {string} content - UTF-8 text content
 * @param {string} mimeType - default 'text/csv;charset=utf-8'
 */
export function downloadFile(filename, content, mimeType) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['﻿' + content], { type: mimeType || 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  // 延迟回收：click() 后立即 revoke 在 Firefox 下可能取消下载
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/**
 * Generate template export JSON (version 5: includes plate layout settings).
 */
export function exportTemplateJson(blocks, experiment, replicateCount, plateSettings) {
  return JSON.stringify({
    app: 'qpcr-tools',
    kind: 'plate-template',
    version: 5,
    replicateCount,
    experiment,
    plate: plateSettings || {},
    blocks
  }, null, 2);
}
