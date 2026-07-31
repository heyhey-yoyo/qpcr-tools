// localStorage migration tests (v5/v6 → v7)
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
      targetGenes: ['IL6']
    },
    ref: 'GAPDH',
    control: 'NC',
    plate: { size: '96', startRow: 'A', startCol: '1', direction: 'horizontal', gap: '0' },
    mode: 'ddct',
    spread: '0.5'
  };

  const v7 = migrateState(v5);

  check('T1 experiment.groups exists', Array.isArray(v7.experiment.groups), true);
  check('T1 experiment.refGene exists', !!v7.experiment.refGene, true);
  check('T1 experiment.refGene.id', v7.experiment.refGene.id, 'ref');
  check('T1 experiment.refGene.name', v7.experiment.refGene.name, 'GAPDH');
  check('T1 targetGenes is array of objects', typeof v7.experiment.targetGenes[0], 'object');
  check('T1 targetGenes[0].name', v7.experiment.targetGenes[0].name, 'IL6');
  check('T1 groups[0].compareToGroupId', v7.experiment.groups[0].compareToGroupId, null);
  check('T1 groups[1].compareToGroupId', v7.experiment.groups[1].compareToGroupId, 'g1');
  check('T1 isControl removed', v7.experiment.groups[0].isControl, undefined);
  check('T1 _version', v7._version, 7);
  check('T1 ref removed', v7.ref, undefined);
  check('T1 control removed', v7.control, undefined);
}

// ---- T2: v6 state migrates to v7 ----
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
  check('T2 _version', result._version, 7);
  check('T2 blocks preserved', result.blocks[0].groupId, 'g1');
  check('T2 experiment.refGene preserved', result.experiment.refGene.id, 'ref');
  check('T2 NC compareToGroupId', result.experiment.groups[0].compareToGroupId, null);
  check('T2 Treatment compareToGroupId', result.experiment.groups[1].compareToGroupId, 'g1');
  check('T2 isControl removed from groups', result.experiment.groups[0].isControl, undefined);
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

  const v7 = migrateState(v5);
  check('T3 two target genes', v7.experiment.targetGenes.length, 2);
  check('T3 tg[0].name', v7.experiment.targetGenes[0].name, 'IL6');
  check('T3 tg[1].name', v7.experiment.targetGenes[1].name, 'TNF');
  check('T3 NC compareToGroupId', v7.experiment.groups[0].compareToGroupId, null);
  check('T3 block geneId resolved', !!v7.blocks[0].geneId, true);
}

// ---- T4: Null/empty state ----
{
  check('T4 null state', migrateState(null), null);
}

// ---- T5: v6 state with custom refGene.name preserved ----
{
  const v6 = {
    _version: 6,
    blocks: [
      { sample: 'NC-1', group: 'NC', groupId: 'g1', gene: 'ACTB', geneId: 'ref', role: 'reference', reps: 3, breakBefore: false }
    ],
    rows: [],
    replicateCount: 3,
    experiment: {
      groups: [
        { id: 'g1', name: 'NC', isControl: true },
        { id: 'g2', name: 'Treatment', isControl: false }
      ],
      biologicalReplicates: 1,
      targetGenes: [{ id: 'tg1', name: 'IL6' }],
      refGene: { id: 'ref', name: 'ACTB' }
    },
    plate: { size: '96' },
    mode: 'ddct',
    spread: '0.5'
  };

  const v7 = migrateState(v6);
  check('T5 refGene.name preserved', v7.experiment.refGene.name, 'ACTB');
  check('T5 refGene.id preserved', v7.experiment.refGene.id, 'ref');
  check('T5 targetGenes preserved', v7.experiment.targetGenes.length, 1);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
