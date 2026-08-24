// ΔCt / ΔΔCt calculation regression tests
// Usage: node test/ddct.mjs

import { computeAnalysis } from '../core/ddct.js';

let failures = 0;

function check(label, actual, expected) {
  const ok = typeof expected === 'number'
    ? Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9
    : actual === expected;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function mkExperiment(groups, targetGenes, refGene) {
  return { groups, biologicalReplicates: 1, targetGenes, refGene };
}

function mkRow(name, group, groupId, gene, geneId, cts) {
  return { wells: [], name, group, groupId, gene, geneId, cts };
}

function mkPair(name, group, groupId, gene, geneId, dct, refGeneId) {
  return [
    mkRow(name, group, groupId, experiment.refGene.name, refGeneId, [20, 20, 20]),
    mkRow(name, group, groupId, gene, geneId, [20 + dct, 20 + dct, 20 + dct])
  ];
}

// ---- Setup: standard experiment with compareToGroupId ----
const experiment = mkExperiment(
  [
    { id: 'g1', name: 'NC', compareToGroupId: null },
    { id: 'g2', name: 'Treatment', compareToGroupId: 'g1' }
  ],
  [
    { id: 'tg1', name: 'IL6' },
    { id: 'tg2', name: 'TNF' }
  ],
  { id: 'ref', name: 'GAPDH' }
);

// ---- T1: Multi-gene baseline isolation ----
{
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('NC', 'NC', 'g1', 'TNF', 'tg2', 10, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'TNF', 'tg2', 8, 'ref')
  ];
  const { results } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });

  const il6Treat = results.find(i => i.name === 'Treat' && i.geneId === 'tg1');
  const tnfTreat = results.find(i => i.name === 'Treat' && i.geneId === 'tg2');
  check('T1 IL6 ddct', il6Treat.ddct, -2);
  check('T1 IL6 fold', il6Treat.fold, 4);
  check('T1 TNF ddct', tnfTreat.ddct, -2);
  check('T1 TNF fold', tnfTreat.fold, 4);
  // Baseline groups
  const il6NC = results.find(i => i.name === 'NC' && i.geneId === 'tg1');
  check('T1 NC isBaseline', il6NC.isBaseline, true);
  check('T1 NC ddct=0', il6NC.ddct, 0);
  check('T1 NC fold=1', il6NC.fold, 1);
}

// ---- T2: Missing comparison data for a gene ----
{
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'TNF', 'tg2', 10, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const { results } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const missing = results.find(i => i.geneId === 'tg1');
  check('T2 IL6 missingControl', missing.missingControl, true);
  check('T2 IL6 ddct null', missing.ddct, null);
  check('T2 IL6 fold null', missing.fold, null);
}

// ---- T3: Case/space ID match ----
{
  const exp2 = mkExperiment(
    [{ id: 'g1', name: 'NC', compareToGroupId: null }, { id: 'g2', name: 'Treatment', compareToGroupId: 'g1' }],
    [{ id: 'tg1', name: ' IL6 ' }],
    { id: 'ref', name: 'gapdh' }
  );
  const rows = [
    mkRow('NC', 'NC', 'g1', ' IL6 ', 'tg1', [25, 25, 25]),
    mkRow('NC', 'NC', 'g1', 'gapdh', 'ref', [20, 20, 20]),
    mkRow('Treat', 'Treatment', 'g2', 'il6', 'tg1', [23, 23, 23]),
    mkRow('Treat', 'Treatment', 'g2', 'GAPDH', 'ref', [20, 20, 20])
  ];
  const { results } = computeAnalysis({ rows, experiment: exp2, mode: 'ddct', maxSpread: 0.5 });
  const treat = results.find(i => i.name === 'Treat');
  check('T3 case/space ID match', treat.controlMean, 5);
  check('T3 ddct', treat.ddct, -2);
  check('T3 fold', treat.fold, 4);
}

// ---- T4: Cross-gene isolation ----
{
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'TNF', 'tg2', 10, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const { results } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const t4 = results.find(i => i.geneId === 'tg1');
  check('T4 IL6 missingControl (no IL6 in NC)', t4.missingControl, true);
}

// ---- T5: Replicate order independence ----
{
  const base = [
    mkRow('NC', 'NC', 'g1', 'GAPDH', 'ref', [19.2, 20.1, 20.7]),
    mkRow('NC', 'NC', 'g1', 'IL6', 'tg1', [24.1, 25.3, 24.7]),
    mkRow('Treat', 'Treatment', 'g2', 'GAPDH', 'ref', [19.8, 20.4, 19.5]),
    mkRow('Treat', 'Treatment', 'g2', 'IL6', 'tg1', [22.2, 23.1, 22.6])
  ];
  const { results: r1 } = computeAnalysis({ rows: base, experiment, mode: 'ddct', maxSpread: 0.5 });
  const shuffled = base.map(r => ({ ...r, cts: [...r.cts].reverse() }));
  const { results: r2 } = computeAnalysis({ rows: shuffled, experiment, mode: 'ddct', maxSpread: 0.5 });
  const a = r1.find(i => i.name === 'Treat');
  const b = r2.find(i => i.name === 'Treat');
  check('T5 dct unchanged', a.dct, b.dct);
  check('T5 error unchanged', a.error, b.error);
  check('T5 fold unchanged', a.fold, b.fold);
}

// ---- T6: Baseline group baseline ----
{
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const { results } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const ctrl = results.find(i => i.groupId === 'g1');
  check('T6 baseline ddct is 0', ctrl.ddct, 0);
  check('T6 baseline fold is 1', ctrl.fold, 1);
  check('T6 baseline error null', ctrl.error, null);
  check('T6 baseline isBaseline', ctrl.isBaseline, true);
  check('T6 baseline foldLow == fold', ctrl.foldLow, ctrl.fold);
  check('T6 baseline foldHigh == fold', ctrl.foldHigh, ctrl.fold);
}

// ---- T7: Error type labeling ----
{
  const rows = [
    mkRow('NC', 'NC', 'g1', 'GAPDH', 'ref', [19.2, 20.1, 20.7]),
    mkRow('NC', 'NC', 'g1', 'IL6', 'tg1', [24.1, 25.3, 24.7]),
    mkRow('Treat', 'Treatment', 'g2', 'GAPDH', 'ref', [19.8, 20.4, 19.5]),
    mkRow('Treat', 'Treatment', 'g2', 'IL6', 'tg1', [22.2, 23.1, 22.6])
  ];
  const { results } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const treat = results.find(i => i.name === 'Treat');
  const ctrl = results.find(i => i.name === 'NC');
  check('T7 treatment errorType techSem', treat.errorType, 'techSem');
  check('T7 treatment error not null', Number.isFinite(treat.error), true);
  check('T7 baseline errorType null', ctrl.errorType, null);
  check('T7 baseline error null', ctrl.error, null);
  check('T7 baseline foldLow == fold', ctrl.foldLow, ctrl.fold);
}

// ---- T8: Single-replicate handling ----
{
  const rows = [
    mkRow('NC', 'NC', 'g1', 'GAPDH', 'ref', [20, 20, 20]),
    mkRow('NC', 'NC', 'g1', 'IL6', 'tg1', [25, '', '']),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const { results, notes } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const nc = results.find(i => i.name === 'NC');
  check('T8 single-well kept', results.filter(i => i.name === 'NC').length, 1);
  check('T8 single-well dct', nc.dct, 5);
  check('T8 single-well error null', nc.error, null);
  check('T8 single-well qc false', nc.qc, false);
  check('T8 single-well note recorded', notes.singleRep.length, 1);
}

// ---- T9: Multi-baseline biological samples, SEM separation ----
{
  const rows = [
    ...mkPair('NC-1', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('NC-2', 'NC', 'g1', 'IL6', 'tg1', 6, 'ref'),
    mkRow('Treat', 'Treatment', 'g2', 'GAPDH', 'ref', [19.8, 20.2, 20.0]),
    mkRow('Treat', 'Treatment', 'g2', 'IL6', 'tg1', [22.8, 23.2, 23.0])
  ];
  const { results, controlStatsByGene } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const cs = controlStatsByGene.get('g1|||tg1');
  check('T9 baseline mean over 2 samples', cs.mean, 5.5);
  check('T9 baseline bioSem', cs.bioSem, 0.5);
  const treat = results.find(i => i.name === 'Treat');
  check('T9 controlN is 2', treat.controlN, 2);
  check('T9 error is techSem only', treat.error, treat.techSem);
  check('T9 ddct', treat.ddct, 3 - 5.5);
}

// ---- T10: Group rename — IDs don't change, analysis unaffected ----
{
  const exp3 = mkExperiment(
    [{ id: 'g1', name: 'Control', compareToGroupId: null }, { id: 'g2', name: 'Treat', compareToGroupId: 'g1' }],
    [{ id: 'tg1', name: 'GeneX' }],
    { id: 'ref', name: 'RefGene' }
  );
  const rows = [
    ...mkPair('C1', 'Control', 'g1', 'GeneX', 'tg1', 5, 'ref'),
    ...mkPair('T1', 'Treat', 'g2', 'GeneX', 'tg1', 3, 'ref')
  ];
  const { results: r1 } = computeAnalysis({ rows, experiment: exp3, mode: 'ddct', maxSpread: 0.5 });
  const exp3Renamed = mkExperiment(
    [{ id: 'g1', name: 'NC_New', compareToGroupId: null }, { id: 'g2', name: 'Treatment_New', compareToGroupId: 'g1' }],
    [{ id: 'tg1', name: 'IL6_New' }],
    { id: 'ref', name: 'GAPDH_New' }
  );
  const { results: r2 } = computeAnalysis({ rows, experiment: exp3Renamed, mode: 'ddct', maxSpread: 0.5 });
  const t1a = r1.find(i => i.name === 'T1');
  const t1b = r2.find(i => i.name === 'T1');
  check('T10 rename: ddct unchanged', t1a.ddct, t1b.ddct);
  check('T10 rename: fold unchanged', t1a.fold, t1b.fold);
  check('T10 rename: controlMean unchanged', t1a.controlMean, t1b.controlMean);
}

// ---- T11: Single bio sample → bioSem === null ----
{
  const rows = [
    ...mkPair('NC-1', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const { controlStatsByGene } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const cs = controlStatsByGene.get('g1|||tg1');
  check('T11 single bio sample: n', cs.n, 1);
  check('T11 single bio sample: bioSem null', cs.bioSem, null);
  check('T11 single bio sample: mean exists', cs.mean, 5);
}

// ---- T12: Multiple biological samples → bioSem computed ----
{
  const rows = [
    ...mkPair('NC-1', 'NC', 'g1', 'IL6', 'tg1', 4, 'ref'),
    ...mkPair('NC-2', 'NC', 'g1', 'IL6', 'tg1', 6, 'ref'),
    ...mkPair('NC-3', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref')
  ];
  const { controlStatsByGene } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const cs = controlStatsByGene.get('g1|||tg1');
  check('T12 multi bio sample: n', cs.n, 3);
  check('T12 multi bio sample: mean', cs.mean, 5);
  check('T12 multi bio sample: bioSem > 0', cs.bioSem > 0, true);
}

// ---- T13: Delete group — associated rows excluded ----
{
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const filtered = rows.filter(r => r.groupId !== 'g2');
  const { results } = computeAnalysis({ rows: filtered, experiment, mode: 'ddct', maxSpread: 0.5 });
  check('T13 deleted group data excluded', results.filter(i => i.groupId === 'g2').length, 0);
  check('T13 remaining data intact', results.filter(i => i.groupId === 'g1').length, 1);
}

// ---- T14: Delete target gene — associated rows excluded ----
{
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('NC', 'NC', 'g1', 'TNF', 'tg2', 10, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'TNF', 'tg2', 8, 'ref')
  ];
  const filtered = rows.filter(r => r.geneId !== 'tg2');
  const { results } = computeAnalysis({ rows: filtered, experiment, mode: 'ddct', maxSpread: 0.5 });
  check('T14 deleted gene data excluded', results.filter(i => i.geneId === 'tg2').length, 0);
  check('T14 remaining gene intact', results.filter(i => i.geneId === 'tg1').length > 0, true);
}

// ---- T15: Delete without associated data — no side effects ----
{
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const filtered = rows.filter(r => r.groupId !== 'g3');
  const { results } = computeAnalysis({ rows: filtered, experiment, mode: 'ddct', maxSpread: 0.5 });
  check('T15 no side effects on unrelated data', results.length, 2);
}

// ---- T16: Multiple baselines — independent calibration ----
{
  const multiExp = mkExperiment(
    [
      { id: 'g1', name: 'NC1', compareToGroupId: null },
      { id: 'g2', name: 'Treat1', compareToGroupId: 'g1' },
      { id: 'g3', name: 'NC2', compareToGroupId: null },
      { id: 'g4', name: 'Treat2', compareToGroupId: 'g3' }
    ],
    [{ id: 'tg1', name: 'IL6' }],
    { id: 'ref', name: 'GAPDH' }
  );
  const rows = [
    ...mkPair('NC1', 'NC1', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('Treat1', 'Treat1', 'g2', 'IL6', 'tg1', 3, 'ref'),
    ...mkPair('NC2', 'NC2', 'g3', 'IL6', 'tg1', 8, 'ref'),
    ...mkPair('Treat2', 'Treat2', 'g4', 'IL6', 'tg1', 6, 'ref')
  ];
  const { results } = computeAnalysis({ rows, experiment: multiExp, mode: 'ddct', maxSpread: 0.5 });

  const treat1 = results.find(i => i.groupId === 'g2');
  const treat2 = results.find(i => i.groupId === 'g4');
  const nc1 = results.find(i => i.groupId === 'g1');
  const nc2 = results.find(i => i.groupId === 'g3');

  check('T16 Treat1 compareToGroupId', treat1.compareToGroupId, 'g1');
  check('T16 Treat2 compareToGroupId', treat2.compareToGroupId, 'g3');
  check('T16 Treat1 ddct', treat1.ddct, 3 - 5);   // dct=3, baseline mean=5
  check('T16 Treat2 ddct', treat2.ddct, 6 - 8);   // dct=6, baseline mean=8
  check('T16 NC1 isBaseline', nc1.isBaseline, true);
  check('T16 NC1 ddct=0', nc1.ddct, 0);
  check('T16 NC1 error null', nc1.error, null);
  check('T16 NC2 isBaseline', nc2.isBaseline, true);
  check('T16 NC2 ddct=0', nc2.ddct, 0);
  check('T16 Treat1 error not null', Number.isFinite(treat1.error), true);
  check('T16 Treat2 error not null', Number.isFinite(treat2.error), true);
}

// ---- T17: Per-baseline missing gene ----
{
  const multiExp = mkExperiment(
    [
      { id: 'g1', name: 'NC1', compareToGroupId: null },
      { id: 'g2', name: 'Treat1', compareToGroupId: 'g1' },
      { id: 'g3', name: 'NC2', compareToGroupId: null },
      { id: 'g4', name: 'Treat2', compareToGroupId: 'g3' }
    ],
    [{ id: 'tg1', name: 'IL6' }],
    { id: 'ref', name: 'GAPDH' }
  );
  // NC1 has NO IL6 rows — only NC2 does
  const rows = [
    ...mkPair('NC2', 'NC2', 'g3', 'IL6', 'tg1', 8, 'ref'),
    ...mkPair('Treat1', 'Treat1', 'g2', 'IL6', 'tg1', 3, 'ref'),
    ...mkPair('Treat2', 'Treat2', 'g4', 'IL6', 'tg1', 6, 'ref')
  ];
  const { results } = computeAnalysis({ rows, experiment: multiExp, mode: 'ddct', maxSpread: 0.5 });
  const treat1 = results.find(i => i.groupId === 'g2');
  const treat2 = results.find(i => i.groupId === 'g4');
  check('T17 Treat1 missingControl (no IL6 in NC1)', treat1.missingControl, true);
  check('T17 Treat1 ddct null', treat1.ddct, null);
  check('T17 Treat2 computed normally', treat2.missingControl ? false : true, true);
  check('T17 Treat2 ddct', treat2.ddct, 6 - 8);
}

// ---- T18: Dangling comparison ref → treated as baseline ----
{
  const badExp = mkExperiment(
    [
      { id: 'g1', name: 'NC', compareToGroupId: null },
      { id: 'g2', name: 'Treat', compareToGroupId: 'ghost' }
    ],
    [{ id: 'tg1', name: 'IL6' }],
    { id: 'ref', name: 'GAPDH' }
  );
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('Treat', 'Treat', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const { results } = computeAnalysis({ rows, experiment: badExp, mode: 'ddct', maxSpread: 0.5 });
  // Treat has dangling ref → treated as its own baseline
  const treat = results.find(i => i.groupId === 'g2');
  check('T18 dangling ref: treat isBaseline', treat.isBaseline, true);
  check('T18 dangling ref: treat compareToGroupId', treat.compareToGroupId, 'g2');
  check('T18 dangling ref: treat ddct=0', treat.ddct, 0);
  check('T18 dangling ref: treat fold=1', treat.fold, 1);
}

// ---- T19: Non-transitive comparison (direct only) ----
{
  // g2→g3, g3→g1. g2 compares to g3 (direct, not g1)
  const chainExp = mkExperiment(
    [
      { id: 'g1', name: 'NC', compareToGroupId: null },
      { id: 'g3', name: 'Middle', compareToGroupId: 'g1' },
      { id: 'g2', name: 'Treat', compareToGroupId: 'g3' }
    ],
    [{ id: 'tg1', name: 'IL6' }],
    { id: 'ref', name: 'GAPDH' }
  );
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('Middle', 'Middle', 'g3', 'IL6', 'tg1', 7, 'ref'),
    ...mkPair('Treat', 'Treat', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const { results } = computeAnalysis({ rows, experiment: chainExp, mode: 'ddct', maxSpread: 0.5 });

  const treat = results.find(i => i.groupId === 'g2');
  const middle = results.find(i => i.groupId === 'g3');
  // g2→g3→g1 chain resolves to g1 as baseline (not g3)
  check('T19 Treat compareToGroupId', treat.compareToGroupId, 'g1');
  check('T19 Treat controlMean = g1 mean', treat.controlMean, 5);
  check('T19 Treat ddct', treat.ddct, 3 - 5);
  // g3 is NOT a baseline (it compares to g1), so g3 gets error bars
  check('T19 Middle isBaseline', middle.isBaseline, false);
  check('T19 Middle compareToGroupId', middle.compareToGroupId, 'g1');
  check('T19 Middle ddct', middle.ddct, 7 - 5);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
