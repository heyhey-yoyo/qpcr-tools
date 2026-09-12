import assert from 'node:assert/strict';
import { groupChartSvg, resultsChartSvg } from '../ui/charts.js';
const genes = ['IL6', 'SP1', 'AKT', 'TP53', 'MYC', 'EGFR', '<Gene&7>'];
const items = genes.flatMap(gene => [{ gene, group: 'NC', name: 'NC-1', ddct: 0, fold: 1, qc: true }, { gene, group: 'Treatment', name: 'T-1', ddct: -2, fold: 4, qc: true }]);
const svg = groupChartSvg(items, genes);
assert.match(svg, /<defs><pattern/);
assert.match(svg, /<title>NC · IL6：1<\/title>/);
assert.match(svg, /<title>Treatment · IL6：4<\/title>/);
assert.ok(!svg.includes('<Gene&7>'));
assert.ok(svg.includes('&lt;Gene&amp;7&gt;'));
// 即使超过六种配色，每根柱下也保留对应基因文字和完整 title。
for (const gene of genes.slice(0, 6)) assert.ok(svg.split(`<title>${gene}</title>`).length >= 4);
assert.match(resultsChartSvg(items), /font-size="12"/);
assert.doesNotMatch(svg, /NaN|Infinity/);
assert.equal(groupChartSvg([], genes), '');
console.log('PASS grouped values, gene labels beyond six series, XML escaping, empty chart');
