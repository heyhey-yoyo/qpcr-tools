const fs = require('fs');
const src = fs.readFileSync('app.js', 'utf8');

// Extract the pure functions under test.
const grab = name => src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`))[0];

let latest = [];
let latestNotes = { merged: [], singleRep: [] };
let capturedControlStats = null;
const els = {
  ref: { value: 'GAPDH' },
  control: { value: 'NC' },
  spread: { value: '0.5' },
  mode: { value: 'ddct' }
};
let rows = [];
function renderResults(controlStatsByGene) { capturedControlStats = controlStatsByGene; }
function save() {}

eval(grab('mean'));
eval(grab('stats'));
eval(grab('calculate'));

let failures = 0;
function check(label, actual, expected) {
  const ok = typeof expected === 'number'
    ? Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9
    : actual === expected;
  if (!ok) { failures += 1; console.log(`FAIL ${label}: got ${actual}, want ${expected}`); }
  else console.log(`ok   ${label}`);
}
function run(inputRows) {
  rows = inputRows;
  latest = [];
  calculate();
}
// Build rows so that mean(target)-mean(ref) equals the wanted dct (ref fixed at 20).
const mk = (name, group, gene, dct) => [
  { name, group, gene: 'GAPDH', cts: [20, 20, 20] },
  { name, group, gene, cts: [20 + dct, 20 + dct, 20 + dct] }
];

// --- 测试一：多基因对照均值隔离 ---
run([
  ...mk('NC', 'NC', 'IL6', 5),
  ...mk('NC', 'NC', 'TNF', 10),
  ...mk('Treat', 'Treatment', 'IL6', 3),
  ...mk('Treat', 'Treatment', 'TNF', 8)
]);
const byGene = g => latest.filter(i => i.gene === g);
check('T1 IL6 controlMean', byGene('IL6').find(i => i.group === 'NC').controlMean, 5);
check('T1 TNF controlMean', byGene('TNF').find(i => i.group === 'NC').controlMean, 10);
const il6Treat = latest.find(i => i.name === 'Treat' && i.gene === 'IL6');
const tnfTreat = latest.find(i => i.name === 'Treat' && i.gene === 'TNF');
check('T1 IL6 ddct', il6Treat.ddct, -2);
check('T1 IL6 fold', il6Treat.fold, 4);
check('T1 TNF ddct', tnfTreat.ddct, -2);
check('T1 TNF fold', tnfTreat.fold, 4);
check('T1 IL6 fold is not 22.63', il6Treat.fold !== 22.6274 && il6Treat.fold === 4, true);

// --- 测试二：缺少某个基因的对照数据 ---
run([
  ...mk('NC', 'NC', 'TNF', 10),
  ...mk('Treat', 'Treatment', 'IL6', 3)
]);
const missing = latest.find(i => i.gene === 'IL6');
check('T2 IL6 missingControl', missing.missingControl, true);
check('T2 IL6 ddct null', missing.ddct, null);
check('T2 IL6 fold null', missing.fold, null);
check('T2 no 2^-dct fallback', missing.fold !== Math.pow(2, -3), true);

// --- 测试三：基因名称大小写和空格 ---
run([
  ...mk('NC', 'NC', ' IL6 ', 5),
  ...mk('Treat', 'Treatment', 'il6', 3)
]);
const treatIL6 = latest.find(i => i.name === 'Treat');
check('T3 case/space controlMean', treatIL6.controlMean, 5);
check('T3 ddct', treatIL6.ddct, -2);
check('T3 fold', treatIL6.fold, 4);

// --- 测试四：不同基因不能互相提供对照数据 ---
run([
  ...mk('NC', 'NC', 'TNF', 10),
  ...mk('Treat', 'Treatment', 'IL6', 3)
]);
const t4 = latest.find(i => i.gene === 'IL6');
check('T4 IL6 missingControl', t4.missingControl, true);
check('T4 fold not from TNF control', t4.fold !== Math.pow(2, -(3 - 10)), true);

// --- 测试五：独立孔重复顺序不影响误差 ---
const base = [
  { name: 'NC', group: 'NC', gene: 'GAPDH', cts: [19.2, 20.1, 20.7] },
  { name: 'NC', group: 'NC', gene: 'IL6', cts: [24.1, 25.3, 24.7] },
  { name: 'Treat', group: 'Treatment', gene: 'GAPDH', cts: [19.8, 20.4, 19.5] },
  { name: 'Treat', group: 'Treatment', gene: 'IL6', cts: [22.2, 23.1, 22.6] }
];
run(base);
const r1 = latest.find(i => i.name === 'Treat');
const shuffled = base.map(r => ({ ...r, cts: [...r.cts].reverse() }));
run(shuffled);
const r2 = latest.find(i => i.name === 'Treat');
check('T5 dct unchanged', r1.dct, r2.dct);
check('T5 error unchanged', r1.error, r2.error);
check('T5 fold unchanged', r1.fold, r2.fold);

// --- 测试六：对照组样本是基准，不画传播误差棒 ---
run([
  ...mk('NC', 'NC', 'IL6', 5),
  ...mk('Treat', 'Treatment', 'IL6', 3)
]);
const controlItem = latest.find(i => i.group === 'NC');
check('T6 control ddct is 0', controlItem.ddct, 0);
check('T6 control fold is 1', controlItem.fold, 1);
check('T6 control error null', controlItem.error, null);
check('T6 control foldLow == fold', controlItem.foldLow, controlItem.fold);
check('T6 control foldHigh == fold', controlItem.foldHigh, controlItem.fold);
const treatItem6 = latest.find(i => i.group === 'Treatment');
check('T6 treatment keeps error bar', Number.isFinite(treatItem6.error), true);

// --- 测试七：重复“样本+组别+基因”记录合并技术重复 ---
run([
  { name: 'NC', group: 'NC', gene: 'GAPDH', cts: [20, 20, 20] },
  { name: 'NC', group: 'NC', gene: 'IL6', cts: [24, 24, 24] },
  { name: 'NC', group: 'NC', gene: 'IL6', cts: [26, 26, 26] },
  ...mk('Treat', 'Treatment', 'IL6', 3)
]);
check('T7 merged into one result', latest.filter(i => i.name === 'NC' && i.gene === 'IL6').length, 1);
const mergedItem = latest.find(i => i.name === 'NC');
check('T7 merged mean (24+26)/2 -> dct 5', mergedItem.dct, 5);
check('T7 merged note recorded', latestNotes.merged.length, 1);
const treatItem7 = latest.find(i => i.name === 'Treat');
check('T7 treatment fold uses merged control', treatItem7.fold, 4);

// --- 测试八：单个有效孔仍给出点估计，但无误差棒并标记为单孔 ---
run([
  { name: 'NC', group: 'NC', gene: 'GAPDH', cts: [20, 20, 20] },
  { name: 'NC', group: 'NC', gene: 'IL6', cts: [25, '', ''] },
  ...mk('Treat', 'Treatment', 'IL6', 3)
]);
const nc8 = latest.find(i => i.name === 'NC');
check('T8 single-well record kept', latest.filter(i => i.name === 'NC').length, 1);
check('T8 single-well dct computed', nc8.dct, 5);
check('T8 single-well error null', nc8.error, null);
check('T8 single-well qc false', nc8.qc, false);
check('T8 single-well foldLow == fold', nc8.foldLow, nc8.fold);
check('T8 single-well note recorded', latestNotes.singleRep.length, 1);
const treat8 = latest.find(i => i.name === 'Treat');
check('T8 treatment computes with single-well control', treat8.fold, 4);
check('T8 treatment not missing control', treat8.missingControl === undefined, true);

// --- 测试九：多对照生物学样本时，样本间变异不混入误差棒 ---
run([
  ...mk('NC-1', 'NC', 'IL6', 5),
  ...mk('NC-2', 'NC', 'IL6', 6),
  { name: 'Treat', group: 'Treatment', gene: 'GAPDH', cts: [19.8, 20.2, 20.0] },
  { name: 'Treat', group: 'Treatment', gene: 'IL6', cts: [22.8, 23.2, 23.0] }
]);
const controlStats9 = capturedControlStats.get('il6');
check('T9 control mean over 2 samples', controlStats9.mean, 5.5);
check('T9 control between-sample SEM', controlStats9.se, 0.5);
const treat9 = latest.find(i => i.name === 'Treat');
check('T9 controlN is 2', treat9.controlN, 2);
check('T9 error bar is technical SEM only', treat9.error, treat9.se);
check('T9 no mixing with control variation', treat9.error !== Math.sqrt(treat9.se ** 2 + 0.25), true);
check('T9 treatment ddct', treat9.ddct, 3 - 5.5);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
