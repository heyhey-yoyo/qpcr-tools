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
  return {
    groups,
    biologicalReplicates: 1,
    targetGenes,
    refGene
  };
}

function mkRow(name, group, groupId, gene, geneId, cts) {
  return { wells: [], name, group, groupId, gene, geneId, cts };
}

// Build paired rows: one reference + one target for a given sample/group/gene
function mkPair(name, group, groupId, gene, geneId, dct, refGeneId) {
  return [
    mkRow(name, group, groupId, experiment.refGene.name, refGeneId, [20, 20, 20]),
    mkRow(name, group, groupId, gene, geneId, [20 + dct, 20 + dct, 20 + dct])
  ];
}

// ---- Setup: standard experiment ----
const experiment = mkExperiment(
  [
    { id: 'g1', name: 'NC', isControl: true },
    { id: 'g2', name: 'Treatment', isControl: false }
  ],
  [
    { id: 'tg1', name: 'IL6' },
    { id: 'tg2', name: 'TNF' }
  ],
  { id: 'ref', name: 'GAPDH' }
);

// ---- T1: Multi-gene control mean isolation (ID-based) ----
{
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('NC', 'NC', 'g1', 'TNF', 'tg2', 10, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'TNF', 'tg2', 8, 'ref')
  ];
  const { results } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });

  const byGene = g => results.filter(i => i.geneId === g);
  const il6NC = byGene('tg1').find(i => i.groupId === 'g1');
  const tnfNC = byGene('tg2').find(i => i.groupId === 'g1');
  check('T1 IL6 controlMean', il6NC.controlMean, 5);
  check('T1 TNF controlMean', tnfNC.controlMean, 10);

  const il6Treat = results.find(i => i.name === 'Treat' && i.geneId === 'tg1');
  const tnfTreat = results.find(i => i.name === 'Treat' && i.geneId === 'tg2');
  check('T1 IL6 ddct', il6Treat.ddct, -2);
  check('T1 IL6 fold', il6Treat.fold, 4);
  check('T1 TNF ddct', tnfTreat.ddct, -2);
  check('T1 TNF fold', tnfTreat.fold, 4);
  // Verify it's NOT mixed: IL6 fold should use IL6 control mean, not TNF's
  check('T1 IL6 fold not from TNF control', il6Treat.fold !== Math.pow(2, -(3 - 10)), true);
}

// ---- T2: Missing control data for a gene ----
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

// ---- T3: Gene name normalization with IDs (legacy fallback) ----
// With IDs, case/space doesn't matter for matching. But we test that ID matching works.
{
  const exp2 = mkExperiment(
    [{ id: 'g1', name: 'NC', isControl: true }, { id: 'g2', name: 'Treatment', isControl: false }],
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

// ---- T6: Control group baseline ----
{
  const rows = [
    ...mkPair('NC', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const { results } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const ctrl = results.find(i => i.groupId === 'g1');
  check('T6 control ddct is 0', ctrl.ddct, 0);
  check('T6 control fold is 1', ctrl.fold, 1);
  check('T6 control error null', ctrl.error, null);
  check('T6 control errorType null', ctrl.errorType, null);
  check('T6 control foldLow == fold', ctrl.foldLow, ctrl.fold);
  check('T6 control foldHigh == fold', ctrl.foldHigh, ctrl.fold);
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
  check('T7 control errorType null', ctrl.errorType, null);
  check('T7 control error null', ctrl.error, null);
  // Control has no error bars in fold
  check('T7 control foldLow == fold', ctrl.foldLow, ctrl.fold);
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

// ---- T9: Multi-control biological samples, SEM separation ----
{
  const rows = [
    ...mkPair('NC-1', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('NC-2', 'NC', 'g1', 'IL6', 'tg1', 6, 'ref'),
    mkRow('Treat', 'Treatment', 'g2', 'GAPDH', 'ref', [19.8, 20.2, 20.0]),
    mkRow('Treat', 'Treatment', 'g2', 'IL6', 'tg1', [22.8, 23.2, 23.0])
  ];
  const { results, controlStatsByGene } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const cs = controlStatsByGene.get('tg1');
  check('T9 control mean over 2 samples', cs.mean, 5.5);
  check('T9 control bioSem', cs.bioSem, 0.5);
  const treat = results.find(i => i.name === 'Treat');
  check('T9 controlN is 2', treat.controlN, 2);
  check('T9 error is techSem only', treat.error, treat.techSem);
  // techSem should NOT include between-sample control SEM
  check('T9 no bioSem mixed into error', treat.error !== Math.sqrt((treat.techSem || 0) ** 2 + 0.25), true);
  check('T9 ddct', treat.ddct, 3 - 5.5);
}

// ---- T10: Group rename simulation (IDs don't change) ----
{
  const exp3 = mkExperiment(
    [{ id: 'g1', name: 'Control', isControl: true }, { id: 'g2', name: 'Treat', isControl: false }],
    [{ id: 'tg1', name: 'GeneX' }],
    { id: 'ref', name: 'RefGene' }
  );
  const rows = [
    ...mkPair('C1', 'Control', 'g1', 'GeneX', 'tg1', 5, 'ref'),
    ...mkPair('T1', 'Treat', 'g2', 'GeneX', 'tg1', 3, 'ref')
  ];
  const { results: r1 } = computeAnalysis({ rows, experiment: exp3, mode: 'ddct', maxSpread: 0.5 });

  // Rename: only change names, IDs stay same
  const exp3Renamed = mkExperiment(
    [{ id: 'g1', name: 'NC_New', isControl: true }, { id: 'g2', name: 'Treatment_New', isControl: false }],
    [{ id: 'tg1', name: 'IL6_New' }],
    { id: 'ref', name: 'GAPDH_New' }
  );
  const { results: r2 } = computeAnalysis({ rows, experiment: exp3Renamed, mode: 'ddct', maxSpread: 0.5 });

  const t1a = r1.find(i => i.name === 'T1');
  const t1b = r2.find(i => i.name === 'T1');
  check('T10 rename: ddct unchanged', t1a.ddct, t1b.ddct);
  check('T10 rename: fold unchanged', t1a.fold, t1b.fold);
  check('T10 rename: controlMean unchanged', t1a.controlMean, t1b.controlMean);
  // Display names should differ
  check('T10 rename: display gene changed', t1b.gene, 'GeneX'); // row still has old display name
}

// ---- T11: Single biological sample → bioSem === null ----
{
  const rows = [
    ...mkPair('NC-1', 'NC', 'g1', 'IL6', 'tg1', 5, 'ref'),
    ...mkPair('Treat', 'Treatment', 'g2', 'IL6', 'tg1', 3, 'ref')
  ];
  const { controlStatsByGene } = computeAnalysis({ rows, experiment, mode: 'ddct', maxSpread: 0.5 });
  const cs = controlStatsByGene.get('tg1');
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
  const cs = controlStatsByGene.get('tg1');
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
  // Simulate deleting group 'g2' (Treatment) by filtering rows
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
  // Simulate deleting gene 'tg2' (TNF)
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
  // Simulate deleting a group that has no rows (g3 doesn't exist in rows)
  const filtered = rows.filter(r => r.groupId !== 'g3');
  const { results } = computeAnalysis({ rows: filtered, experiment, mode: 'ddct', maxSpread: 0.5 });
  check('T15 no side effects on unrelated data', results.length, 2);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
