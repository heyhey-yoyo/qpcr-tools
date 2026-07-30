// localStorage migration tests (v5 → v6)
// Usage: node test/migration.mjs

import { migrateState } from '../state/migration.js';

let failures = 0;

function check(label, actual, expected) {
  const ok = typeof expected === 'object' && expected !== null
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : typeof expected === 'number'
      ? Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9
      : actual === expected;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// ---- T1: v5 state with string[] targetGenes migrates correctly ----
{
  const v5 = {
    blocks: [
      { sample: 'NC-1', group: 'NC', gene: 'IL6', role: 'target', reps: 3, breakBefore: false },
      { sample: 'NC-1', group: 'NC', gene: 'GAPDH', role: 'reference', reps: 3, breakBefore: false }
    ],
    rows: [
      { wells: ['A1'], name: 'NC-1', group: 'NC', gene: 'IL6', cts: ['25.1'] },
      { wells: ['A2'], name: 'NC-1', group: 'NC', gene: 'GAPDH', cts: ['19.9'] }
    ],
    replicateCount: 3,
    experiment: {
      groups: [
        { id: 'g1', name: 'NC', isControl: true },
        { id: 'g2', name: 'Treatment', isControl: false }
      ],
      biologicalReplicates: 1,
      targetGenes: ['IL6']   // string[] (v5 format)
    },
    ref: 'GAPDH',
    control: 'NC',
    plate: { size: '96', startRow: 'A', startCol: '1', direction: 'horizontal', gap: '0' },
    mode: 'ddct',
    spread: '0.5'
  };

  const v6 = migrateState(v5);

  // Experiment
  check('T1 experiment.groups exists', Array.isArray(v6.experiment.groups), true);
  check('T1 experiment.groups[0] has id', typeof v6.experiment.groups[0].id, 'string');
  check('T1 experiment.refGene exists', !!v6.experiment.refGene, true);
  check('T1 experiment.refGene.id', v6.experiment.refGene.id, 'ref');
  check('T1 experiment.refGene.name', v6.experiment.refGene.name, 'GAPDH');

  // targetGenes converted from string[] to [{id, name}]
  check('T1 targetGenes is array of objects', typeof v6.experiment.targetGenes[0], 'object');
  check('T1 targetGenes[0] has id', typeof v6.experiment.targetGenes[0].id, 'string');
  check('T1 targetGenes[0].name', v6.experiment.targetGenes[0].name, 'IL6');

  // Blocks got IDs
  check('T1 blocks[0] groupId exists', !!v6.blocks[0].groupId, true);
  check('T1 blocks[0] geneId exists', !!v6.blocks[0].geneId, true);
  check('T1 blocks[0].group (display) preserved', v6.blocks[0].group, 'NC');
  check('T1 blocks[0].gene (display) preserved', v6.blocks[0].gene, 'IL6');
  check('T1 blocks[1] geneId == ref', v6.blocks[1].geneId, 'ref');

  // Rows got IDs
  check('T1 rows[0] groupId exists', !!v6.rows[0].groupId, true);
  check('T1 rows[0] geneId exists', !!v6.rows[0].geneId, true);
  check('T1 rows[1] geneId == ref', v6.rows[1].geneId, 'ref');

  // Old top-level fields removed
  check('T1 ref removed', v6.ref, undefined);
  check('T1 control removed', v6.control, undefined);

  // Version marker
  check('T1 _version', v6._version, 6);
}

// ---- T2: v6 state passes through (no-op migration) ----
{
  const v6 = {
    _version: 6,
    blocks: [
      { sample: 'NC-1', group: 'NC', groupId: 'g1', gene: 'IL6', geneId: 'tg1', role: 'target', reps: 3, breakBefore: false }
    ],
    rows: [
      { wells: ['A1'], name: 'NC-1', group: 'NC', groupId: 'g1', gene: 'IL6', geneId: 'tg1', cts: ['25.1'] }
    ],
    replicateCount: 3,
    experiment: {
      groups: [
        { id: 'g1', name: 'NC', isControl: true },
        { id: 'g2', name: 'Treatment', isControl: false }
      ],
      biologicalReplicates: 1,
      targetGenes: [{ id: 'tg1', name: 'IL6' }],
      refGene: { id: 'ref', name: 'GAPDH' }
    },
    plate: { size: '96' },
    mode: 'ddct',
    spread: '0.5'
  };

  const result = migrateState(v6);
  check('T2 v6 passes through', result._version, 6);
  check('T2 blocks preserved', result.blocks[0].groupId, 'g1');
  check('T2 experiment.refGene preserved', result.experiment.refGene.id, 'ref');
}

// ---- T3: v5 state with multiple target genes ----
{
  const v5 = {
    blocks: [
      { sample: 'NC-1', group: 'NC', gene: 'TNF', role: 'target', reps: 3, breakBefore: false }
    ],
    rows: [],
    replicateCount: 3,
    experiment: {
      groups: [{ id: 'g1', name: 'NC', isControl: true }],
      biologicalReplicates: 1,
      targetGenes: ['IL6', 'TNF']
    },
    ref: 'GAPDH',
    plate: { size: '96' },
    mode: 'ddct',
    spread: '0.5'
  };

  const v6 = migrateState(v5);
  check('T3 two target genes', v6.experiment.targetGenes.length, 2);
  check('T3 tg[0].name', v6.experiment.targetGenes[0].name, 'IL6');
  check('T3 tg[1].name', v6.experiment.targetGenes[1].name, 'TNF');
  // Block geneId should match TNF
  check('T3 block geneId resolved', !!v6.blocks[0].geneId, true);
}

// ---- T4: Null/empty state ----
{
  check('T4 null state', migrateState(null), null);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
