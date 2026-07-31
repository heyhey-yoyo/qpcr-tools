'use strict';

// ---- Imports ----
import { parseCt } from './core/ct.js';
import { mean, rowStats } from './core/statistics.js';
import { normalizeKey } from './core/normalize.js';
import { computeAnalysis } from './core/ddct.js';
import {
  createExperiment, createGroup, addGroup as expAddGroup, addTargetGene as expAddTargetGene,
  renameGroup as expRenameGroup, renameTargetGene as expRenameTargetGene,
  toggleControlGroup as expToggleControl, removeGroup as expRemoveGroup,
  removeTargetGene as expRemoveTargetGene, setRefGeneName,
  getControlGroup, resolveGroupName, resolveGeneName, resolveGroupId, resolveGeneId,
  syncBlockDisplayNames, syncRowDisplayNames
} from './state/experiment.js';
import { migrateState, CURRENT_VERSION } from './state/migration.js';
import { resultsChartSvg, groupChartSvg, fmt } from './ui/charts.js';
import {
  escapeHtml, renderGroups, renderTargetGenes, renderRefGene,
  renderBlocks, readBlocksFromDom, renderPlateGrid,
  renderRows, readRowsFromDom, renderResults, buildAlertsHtml
} from './ui/render.js';
import { parseCtColumn, parseFullTable } from './io/import.js';
import { resultsCsv, plateCsv, downloadFile, exportTemplateJson } from './io/export.js';

// ---- Constants ----
const KEY = 'qpcr-demo-v6';
const LEGACY_KEYS = ['qpcr-demo-v5', 'qpcr-demo-v4', 'qpcr-demo-v3'];
const DEFAULT_REPS = 3;
const MIN_REPS = 1;
const MAX_REPS_GLOBAL = 6;
const PLATES = {
  '96': { size: '96', rows: 'ABCDEFGH'.split(''), cols: 12, label: '96 孔板' },
  '384': { size: '384', rows: 'ABCDEFGHIJKLMNOP'.split(''), cols: 24, label: '384 孔板' }
};
const $ = s => document.querySelector(s);

// ---- DOM refs ----
const els = {
  blocksBody: $('#blocksBody'), plateGrid: $('#plateGrid'), plateLegend: $('#plateLegend'),
  plateAlert: $('#plateAlert'), targets: $('#targetCount'),
  plateSize: $('#plateSize'), startRow: $('#startRow'), startCol: $('#startCol'),
  direction: $('#plateDirection'), gap: $('#blockGap'),
  body: $('#samplesBody'), head: $('#samplesHead'),
  mode: $('#workflowSelect'), spread: $('#maxSpread'),
  desc: $('#modeDescription'), formula: $('#formulaNote'),
  summary: $('#summary'), alerts: $('#alerts'), results: $('#resultsBody'),
  chart: $('#resultsChart'), groupChart: $('#groupChart'),
  paste: $('#pasteArea'), ctColumnPanel: $('#ctColumnPanel'),
  ctColumnArea: $('#ctColumnArea'), ctPasteStatus: $('#ctPasteStatus'),
  repsInput: $('#replicateCount'),
  bioGroupReplicates: $('#bioGroupReplicates'),
  bioGroupRow: $('#bioGroupRow'),
  groupsContainer: $('#groupsContainer'), addGroupBtn: $('#addGroupBtn'),
  bioRepsInput: $('#biologicalReplicates'),
  targetGenesContainer: $('#targetGenesContainer'),
  refGeneContainer: $('#refGeneContainer'),
  addTargetGeneBtn: $('#addTargetGeneBtn')
};

// ---- Global state ----
let replicateCount = DEFAULT_REPS;
let experiment = createExperiment();
let blocks = [];
let rows = [];
let latest = [];
let latestNotes = { merged: [], singleRep: [] };
let latestPlate = { placements: [], overflow: false };
let hasSavedState = false;

// ---- Utilities ----
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function normalizeReplicateCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < MIN_REPS) return DEFAULT_REPS;
  return Math.min(MAX_REPS_GLOBAL, Math.max(MIN_REPS, Math.round(num)));
}

function resizeReplicates(rows, oldCount, newCount) {
  if (oldCount === newCount) return rows;
  if (newCount > oldCount) {
    return rows.map(row => ({
      ...row, cts: [...row.cts, ...Array(newCount - oldCount).fill('')],
      wells: [...(row.wells || []), ...Array(Math.max(0, newCount - (row.wells || []).length)).fill('')]
    }));
  }
  const lostCts = rows.some(row =>
    (row.cts || []).slice(newCount).some(ct => String(ct ?? '').trim() !== '')
  );
  if (lostCts && !window.confirm(`复孔数量从 ${oldCount} 减少到 ${newCount}，Ct${newCount + 1}–Ct${oldCount} 中已有数据将被移除。确认继续？`)) {
    return null;
  }
  return rows.map(row => ({ ...row, cts: (row.cts || []).slice(0, newCount), wells: (row.wells || []).slice(0, newCount) }));
}

function toggleBioGroupVisibility() {
  const show = replicateCount === 1;
  els.bioGroupRow.style.display = show ? '' : 'none';
  if (!show) els.bioGroupReplicates.checked = false;
}

// ---- Experiment config helpers ----

function currentPlate() { return PLATES[els.plateSize.value] || PLATES['96']; }

function maxTargetCount() {
  const plate = currentPlate();
  const groupCount = experiment.groups.length;
  const bioReps = experiment.biologicalReplicates;
  const wellsPerGene = groupCount * bioReps * replicateCount;
  return Math.max(1, Math.floor((plate.rows.length * plate.cols) / wellsPerGene) - 1);
}

function targetCount() {
  const n = experiment.targetGenes.length || 1;
  const max = maxTargetCount();
  const value = Math.max(1, Math.min(max, n));
  els.targets.value = String(value);
  els.targets.max = String(max);
  renderTargetGenes(experiment, max, {
    targetGenesContainer: els.targetGenesContainer,
    addTargetGeneBtn: els.addTargetGeneBtn,
    onRenameTargetGene: handleRenameTargetGene,
    onRemoveTargetGene: handleRemoveTargetGene
  });
  renderRefGene(experiment, {
    refGeneContainer: els.refGeneContainer,
    onRenameRefGene: handleRenameRefGene
  });
  return value;
}

function refreshCoordinateSelects(preferredRow, preferredCol) {
  const plate = currentPlate();
  els.startRow.innerHTML = plate.rows.map(row => `<option value="${row}">${row}</option>`).join('');
  els.startCol.innerHTML = Array.from({ length: plate.cols }, (_, i) => i + 1)
    .map(col => `<option value="${col}">${col}</option>`).join('');
  els.startRow.value = plate.rows.includes(preferredRow) ? preferredRow : plate.rows[0];
  const colNum = Number(preferredCol);
  els.startCol.value = colNum >= 1 && colNum <= plate.cols ? String(colNum) : '1';
  els.targets.max = String(maxTargetCount());
  targetCount();
}

function parseWell(value) {
  const plate = currentPlate();
  const match = String(value).trim().toUpperCase().match(/^([A-P])(\d{1,2})$/);
  if (!match) return null;
  const row = match[1], col = Number(match[2]);
  if (!plate.rows.includes(row) || col < 1 || col > plate.cols) return null;
  return { row, col };
}

// ---- Template ----

function buildTemplate() {
  const template = [];
  const refGene = experiment.refGene || { id: 'ref', name: 'GAPDH' };
  const groupBio = els.bioGroupReplicates && els.bioGroupReplicates.checked;

  experiment.groups.forEach(group => {
    if (groupBio) {
      // Group biological replicates together per gene
      experiment.targetGenes.forEach(gene => {
        for (let bio = 1; bio <= experiment.biologicalReplicates; bio += 1) {
          const sample = `${group.name}-BioRep${bio}`;
          template.push({ sample, group: group.name, groupId: group.id, gene: gene.name, geneId: gene.id, role: 'target', reps: replicateCount, breakBefore: false });
        }
      });
      for (let bio = 1; bio <= experiment.biologicalReplicates; bio += 1) {
        const sample = `${group.name}-BioRep${bio}`;
        template.push({ sample, group: group.name, groupId: group.id, gene: refGene.name, geneId: refGene.id, role: 'reference', reps: replicateCount, breakBefore: false });
      }
    } else {
      // Default: group by biological replicate
      for (let bio = 1; bio <= experiment.biologicalReplicates; bio += 1) {
        const sample = `${group.name}-BioRep${bio}`;
        experiment.targetGenes.forEach(gene => {
          template.push({ sample, group: group.name, groupId: group.id, gene: gene.name, geneId: gene.id, role: 'target', reps: replicateCount, breakBefore: false });
        });
        template.push({ sample, group: group.name, groupId: group.id, gene: refGene.name, geneId: refGene.id, role: 'reference', reps: replicateCount, breakBefore: false });
      }
    }
  });
  return template;
}

function exampleTemplate() {
  const plate = currentPlate();
  experiment.groups = [
    { id: 'ex1', name: 'NC', isControl: true },
    { id: 'ex2', name: '24H', isControl: false },
    { id: 'ex3', name: '48H', isControl: false },
    { id: 'ex4', name: '96H', isControl: false }
  ];
  experiment.biologicalReplicates = 2;
  experiment.targetGenes = [
    { id: 'etg1', name: 'IL-1B' }, { id: 'etg2', name: 'SP1' }, { id: 'etg3', name: 'AKT' }
  ];
  experiment.refGene = { id: 'ref', name: 'ACTB' };
  renderGroups(experiment, { groupsContainer: els.groupsContainer, bioRepsInput: els.bioRepsInput,
    onRenameGroup: handleRenameGroup, onToggleControl: handleToggleControl, onRemoveGroup: handleRemoveGroup });
  targetCount();

  const template = [];
  const groupBio = els.bioGroupReplicates && els.bioGroupReplicates.checked;
  const batches = plate.size === '384' ? [1, 2] : [1];
  batches.forEach(() => {
    experiment.groups.forEach(group => {
      if (groupBio) {
        experiment.targetGenes.forEach(gene => {
          for (let bio = 1; bio <= experiment.biologicalReplicates; bio += 1) {
            const sample = `${group.name}-BioRep${bio}`;
            template.push({ sample, group: group.name, groupId: group.id, gene: gene.name, geneId: gene.id, role: 'target', reps: replicateCount, breakBefore: false });
          }
        });
        for (let bio = 1; bio <= experiment.biologicalReplicates; bio += 1) {
          const sample = `${group.name}-BioRep${bio}`;
          template.push({ sample, group: group.name, groupId: group.id, gene: experiment.refGene.name, geneId: experiment.refGene.id, role: 'reference', reps: replicateCount, breakBefore: false });
        }
      } else {
        for (let bio = 1; bio <= experiment.biologicalReplicates; bio += 1) {
          const sample = `${group.name}-BioRep${bio}`;
          experiment.targetGenes.forEach(gene => {
            template.push({ sample, group: group.name, groupId: group.id, gene: gene.name, geneId: gene.id, role: 'target', reps: replicateCount, breakBefore: false });
          });
          template.push({ sample, group: group.name, groupId: group.id, gene: experiment.refGene.name, geneId: experiment.refGene.id, role: 'reference', reps: replicateCount, breakBefore: false });
        }
      }
    });
  });
  return template;
}

function blankBlock() {
  const refGene = experiment.refGene || { id: 'ref', name: 'GAPDH' };
  const firstGene = experiment.targetGenes[0] || { id: 'tg1', name: 'IL6' };
  const firstGroup = experiment.groups[1] || experiment.groups[0] || { id: 'g1', name: 'Treatment' };
  return { sample: 'Sample-1', group: firstGroup.name, groupId: firstGroup.id, gene: firstGene.name, geneId: firstGene.id, role: 'target', reps: replicateCount, breakBefore: false };
}

function blankRow() {
  return { wells: Array(replicateCount).fill(''), name: 'Sample-1', group: 'NC', groupId: null, gene: 'GAPDH', geneId: null, cts: Array(replicateCount).fill('') };
}

function normalizeBlock(block) {
  return {
    sample: block?.sample || 'Sample-1',
    group: block?.group || 'Treatment',
    groupId: block?.groupId || null,
    gene: block?.gene || 'IL6',
    geneId: block?.geneId || null,
    role: block?.role === 'reference' ? 'reference' : 'target',
    reps: Math.max(MIN_REPS, Math.min(MAX_REPS_GLOBAL, Number(block?.reps) || replicateCount)),
    breakBefore: Boolean(block?.breakBefore)
  };
}

function normalizeRow(row) {
  const cts = Array.isArray(row?.cts) ? row.cts : Array(replicateCount).fill('');
  const wells = Array.isArray(row?.wells) ? row.wells : [];
  return {
    wells: wells.length ? wells : Array(cts.length || replicateCount).fill(''),
    name: row?.name || 'Sample-1',
    group: row?.group || 'NC',
    groupId: row?.groupId || null,
    gene: row?.gene || 'GAPDH',
    geneId: row?.geneId || null,
    cts: cts.length ? cts : Array(replicateCount).fill('')
  };
}

function sampleParts(name) {
  const match = String(name).match(/^(.*?)(\d+)$/);
  return match ? { prefix: match[1], number: Number(match[2]) } : null;
}

function uniqueSampleName(original) {
  const names = blocks.map(b => b.sample);
  if (!names.includes(original)) return original;
  const parts = sampleParts(original);
  if (parts) {
    const maxNum = names.reduce((max, name) => {
      const c = sampleParts(name);
      return c && c.prefix === parts.prefix ? Math.max(max, c.number) : max;
    }, parts.number);
    return `${parts.prefix}${maxNum + 1}`;
  }
  let num = 2;
  while (names.includes(`${original}-${num}`)) num += 1;
  return `${original}-${num}`;
}

// ---- Persistence ----

function save() {
  localStorage.setItem(KEY, JSON.stringify({
    _version: CURRENT_VERSION,
    blocks, rows, replicateCount, experiment,
    plate: {
      size: els.plateSize.value, startRow: els.startRow.value, startCol: els.startCol.value,
      direction: els.direction.value, gap: els.gap.value,
	      targets: els.targets.value,
      bioGroupReplicates: els.bioGroupReplicates.checked
    },
    mode: els.mode.value,
    spread: els.spread.value
  }));
}

function load() {
  try {
    let raw = localStorage.getItem(KEY);
    let state = raw ? JSON.parse(raw) : null;
    if (!state) {
      for (const legacyKey of LEGACY_KEYS) {
        raw = localStorage.getItem(legacyKey);
        if (raw) { state = JSON.parse(raw); break; }
      }
    }
    if (!state) {
      refreshCoordinateSelects('A', '1');
      renderGroups(experiment, { groupsContainer: els.groupsContainer, bioRepsInput: els.bioRepsInput,
        onRenameGroup: handleRenameGroup, onToggleControl: handleToggleControl, onRemoveGroup: handleRemoveGroup });
      return;
    }

    // Migrate if needed
    state = migrateState(state);

    // Restore replicateCount
    if (state.replicateCount !== undefined) {
      replicateCount = normalizeReplicateCount(state.replicateCount);
    } else {
      replicateCount = DEFAULT_REPS;
    }
    els.repsInput.value = String(replicateCount);

    // Restore experiment
    if (state.experiment && Array.isArray(state.experiment.groups) && state.experiment.groups.length) {
      experiment = state.experiment;
      // Ensure IDs exist on all entities
      if (!experiment.refGene || !experiment.refGene.id) {
        experiment.refGene = { id: 'ref', name: experiment.refGene?.name || 'GAPDH' };
      }
      experiment.targetGenes = (experiment.targetGenes || []).map((g, i) =>
        typeof g === 'string' ? { id: 'tg' + (i + 1), name: g } : (g.id ? g : { ...g, id: 'tg' + (i + 1) })
      );
      if (!experiment.targetGenes.length) experiment.targetGenes = [{ id: 'tg1', name: 'IL6' }];
      experiment.groups = experiment.groups.map(g => g.id ? g : { ...g, id: 'g' + Date.now() });
    } else {
      experiment = createExperiment();
    }

    blocks = Array.isArray(state.blocks) ? state.blocks.map(normalizeBlock) : buildTemplate();
    rows = Array.isArray(state.rows) ? state.rows.map(normalizeRow) : clone(exampleRows);

    els.mode.value = state.mode || 'ddct';
    els.spread.value = state.spread || '0.5';

    renderGroups(experiment, { groupsContainer: els.groupsContainer, bioRepsInput: els.bioRepsInput,
      onRenameGroup: handleRenameGroup, onToggleControl: handleToggleControl, onRemoveGroup: handleRemoveGroup });

    const plateSize = PLATES[state.plate?.size] ? state.plate.size : '96';
    els.plateSize.value = plateSize;
    refreshCoordinateSelects(state.plate?.startRow || 'A', state.plate?.startCol || '1');
    els.direction.value = state.plate?.direction || 'horizontal';
    els.gap.value = state.plate?.gap || '0';
    els.targets.value = String(Number(state.plate?.targets) || 1);
    targetCount();
    els.bioGroupReplicates.checked = Boolean(state.plate?.bioGroupReplicates);
    toggleBioGroupVisibility();
    commitLayout(snapshotLayout());
    hasSavedState = true;
  } catch (error) {
    console.warn('无法读取本地数据：', error);
    refreshCoordinateSelects('A', '1');
  }
}

// ---- Plate layout ----

function generatePlacements() {
  const plate = currentPlate();
  const direction = els.direction.value;
  const gap = Number(els.gap.value) || 0;
  const baseRow = Math.max(0, plate.rows.indexOf(els.startRow.value));
  const baseCol = Math.max(0, Number(els.startCol.value) - 1);
  let row = baseRow, col = baseCol;
  const placements = [];
  let overflow = false;

  const advance = () => {
    if (direction === 'horizontal') {
      col += 1;
      if (col >= plate.cols) { row += 1; col = 0; }
    } else {
      row += 1;
      if (row >= plate.rows.length) { col += 1; row = 0; }
    }
  };
  const advanceGap = () => { for (let i = 0; i < gap; i += 1) advance(); };

  blocks.forEach((block, blockIndex) => {
    if (block.breakBefore && blockIndex > 0) {
      const prev = placements[placements.length - 1];
      if (direction === 'horizontal') {
        if (prev && prev.row === row) row += 1;
        col = baseCol;
      } else {
        if (prev && prev.col === col) col += 1;
        row = baseRow;
      }
    }
    for (let rep = 0; rep < replicateCount; rep += 1) {
      if (row < 0 || col < 0 || row >= plate.rows.length || col >= plate.cols) { overflow = true; continue; }
      placements.push({ well: `${plate.rows[row]}${col + 1}`, row, col, blockIndex, rep: rep + 1,
        sample: block.sample || `Sample-${blockIndex + 1}`, group: block.group || '', groupId: block.groupId,
        gene: block.gene || '', geneId: block.geneId, role: block.role || 'target' });
      advance();
    }
    if (blockIndex < blocks.length - 1 && !blocks[blockIndex + 1].breakBefore) advanceGap();
  });
  return { placements, overflow };
}

// ---- Block CRUD ----

function renderAllBlocks() {
  renderBlocks(blocks, experiment, els.blocksBody, {
    onReadBlocks: readBlocks, onMoveBlock: moveBlock, onRemoveBlock: removeBlock
  });
}

function readBlocks() {
  blocks = readBlocksFromDom(els.blocksBody, blocks, experiment, replicateCount);
  if (blocks[0]) blocks[0].breakBefore = false;
  syncRowsFromBlocks();
  renderPlate();
  save();
}

// Regenerate rows from blocks, preserving Ct values by matching (sample, groupId, geneId)
function syncRowsFromBlocks() {
  latestPlate = generatePlacements();
  const placementsByBlock = new Map();
  latestPlate.placements.forEach(item => {
    if (!placementsByBlock.has(item.blockIndex)) placementsByBlock.set(item.blockIndex, []);
    placementsByBlock.get(item.blockIndex).push(item.well);
  });
  // Copy so we can consume matches (splice), preventing duplicate blocks
  // from sharing the same old row's Ct values.
  const remaining = [...rows];
  rows = blocks.map((block, index) => {
    const wells = placementsByBlock.get(index) || [];
    const matchIndex = remaining.findIndex(r =>
      r.name === block.sample && r.groupId === block.groupId && r.geneId === block.geneId
    );
    let match = null;
    if (matchIndex !== -1) {
      match = remaining[matchIndex];
      remaining.splice(matchIndex, 1);
    }
    // Resize cts to match new wells length (plate size, rep count, or
    // layout changes can alter the number of wells per block).
    let cts;
    if (match) {
      cts = [...match.cts];
      while (cts.length < wells.length) cts.push('');
      cts.length = wells.length;
    } else {
      cts = Array(wells.length).fill('');
    }
    return {
      wells,
      name: block.sample,
      group: block.group,
      groupId: block.groupId,
      gene: block.gene,
      geneId: block.geneId,
      cts
    };
  });
  renderAllRows();
}

function moveBlock(event) {
  readBlocks();
  const index = Number(event.currentTarget.closest('tr').dataset.index);
  const nextIndex = event.currentTarget.classList.contains('move-up') ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= blocks.length) return;
  [blocks[index], blocks[nextIndex]] = [blocks[nextIndex], blocks[index]];
  if (blocks[0]) blocks[0].breakBefore = false;
  renderAllBlocks();
  renderPlate();
  syncRowsFromBlocks();
  calculate();
  save();
}

function removeBlock(event) {
  readBlocks();
  const index = Number(event.currentTarget.closest('tr').dataset.index);
  blocks.splice(index, 1);
  if (blocks[0]) blocks[0].breakBefore = false;
  // Sync: remove corresponding row
  if (index < rows.length) rows.splice(index, 1);
  // Regenerate well positions for remaining rows to match new plate layout
  latestPlate = generatePlacements();
  const placementsByBlock = new Map();
  latestPlate.placements.forEach(item => {
    if (!placementsByBlock.has(item.blockIndex)) placementsByBlock.set(item.blockIndex, []);
    placementsByBlock.get(item.blockIndex).push(item.well);
  });
  rows.forEach((row, i) => { row.wells = placementsByBlock.get(i) || []; });
  renderAllBlocks();
  renderAllRows();
  renderPlate();
  calculate();
  save();
}

function loadPreset() {
  blocks = buildTemplate();
  els.startRow.value = currentPlate().rows[0];
  els.startCol.value = '1';
  els.direction.value = 'horizontal';
  els.gap.value = '0';
  if (generatePlacements().overflow) {
    window.alert(`${currentPlate().label}空间不足，预设未载入。请减少分组、基因、生物学重复或技术复孔数，或改用更大孔板。`);
    return;
  }
  renderAllBlocks();
  renderPlate();
  syncRowsFromBlocks();
  calculate();
  save();
}

// ---- Plate layout sync ----

/** Last known-good layout snapshot.  Saved on commit, restored on cancel/overflow. */
let lastGoodLayout = null;

function snapshotLayout() {
  return {
    plateSize: els.plateSize.value,
    startRow: els.startRow.value,
    startCol: els.startCol.value,
    direction: els.direction.value,
    gap: els.gap.value,
    replicateCount,
    blocksReps: blocks.map(b => b.reps),
    bioGroupReplicates: els.bioGroupReplicates.checked
  };
}

function commitLayout(snap) {
  lastGoodLayout = snap;
}

function rollbackLayout(snap) {
  if (!snap) return;
  const s = snap;
  if (els.plateSize.value !== s.plateSize) {
    els.plateSize.value = s.plateSize;
  }
  refreshCoordinateSelects(s.startRow, s.startCol);
  els.direction.value = s.direction;
  els.gap.value = s.gap;
  replicateCount = s.replicateCount;
  els.repsInput.value = String(s.replicateCount);
  blocks.forEach((b, i) => {
    if (i < s.blocksReps.length) b.reps = s.blocksReps[i];
  });
  els.bioGroupReplicates.checked = s.bioGroupReplicates;
  toggleBioGroupVisibility();
  els.targets.max = String(maxTargetCount());
  targetCount();
  renderAllBlocks();
}

/**
 * Called on every plate-layout change (size, start, direction, gap,
 * empty-well click, replicate count).  Checks overflow first, confirms
 * with user when Ct data exists, then maps Ct values by physical well
 * position.  Returns true on success, false if rolled back.
 */
function syncPlateLayout() {
  const oldSnap = lastGoodLayout ? { ...lastGoodLayout } : snapshotLayout();

  // Generate with current settings to check overflow before touching data
  latestPlate = generatePlacements();
  if (latestPlate.overflow) {
    rollbackLayout(oldSnap);
    latestPlate = generatePlacements();
    renderPlate();
    window.alert(
      `当前布局超出${currentPlate().label}容量，已恢复到修改前的设置。\n\n` +
      '请调整起始孔、减少区块间隔、减少复孔数或改用更大孔板。'
    );
    return false;
  }

  // Confirm when Ct data already exists — layout change will remap wells
  const hasData = rows.some(row =>
    (row.cts || []).some(ct => String(ct ?? '').trim() !== '')
  );
  if (hasData) {
    if (!window.confirm(
      '修改孔板布局将重新生成孔位。程序会尝试按原物理孔号保留 Ct 值。\n\n' +
      '建议在修改布局前导出数据备份。确认继续？'
    )) {
      rollbackLayout(oldSnap);
      latestPlate = generatePlacements();
      renderPlate();
      renderAllRows();
      return false;
    }
  }

  // Build well→Ct map from current rows BEFORE regenerating.
  const wellCtMap = new Map();
  rows.forEach(row => {
    (row.wells || []).forEach((well, i) => {
      const ct = (row.cts || [])[i];
      if (well && String(ct ?? '').trim() !== '') {
        wellCtMap.set(well, ct);
      }
    });
  });

  // Group placements by block index
  const placementsByBlock = new Map();
  latestPlate.placements.forEach(item => {
    if (!placementsByBlock.has(item.blockIndex)) placementsByBlock.set(item.blockIndex, []);
    placementsByBlock.get(item.blockIndex).push(item.well);
  });

  // Build new rows: wells from new layout, Ct from well→Ct map
  rows = blocks.map((block, index) => {
    const wells = placementsByBlock.get(index) || [];
    const cts = wells.map(well => wellCtMap.get(well) || '');
    return {
      wells,
      name: block.sample,
      group: block.group,
      groupId: block.groupId,
      gene: block.gene,
      geneId: block.geneId,
      cts
    };
  });

  commitLayout(snapshotLayout());
  renderPlate();
  renderAllRows();
  calculate();
  save();
  return true;
}

// ---- Plate rendering ----

function renderPlate() {
  latestPlate = generatePlacements();
  const plate = currentPlate();
  renderPlateGrid(plate, latestPlate.placements, experiment, els.plateGrid, els.plateAlert, els.plateLegend, {
    onSetStartWell: well => {
      const parsed = parseWell(well);
      if (!parsed) return;
      els.startRow.value = parsed.row;
      els.startCol.value = String(parsed.col);
      syncPlateLayout();
    }
  });

  const total = blocks.length * replicateCount;
  if (latestPlate.overflow) {
    els.plateAlert.innerHTML = `<div class="alert alert-warning">模板需要 ${total} 个孔，但当前位置无法全部放入 ${plate.label}。请提前起始位置、减少空孔或调整"另起一行"。</div>`;
  } else {
    els.plateAlert.innerHTML = '';
  }
}

// ---- Ct rows ----


function fillExampleCts() {
  const refGeneName = experiment.refGene ? experiment.refGene.name : 'GAPDH';
  const refKey = normalizeKey(refGeneName);
  const controlGroup = getControlGroup(experiment);
  const controlKey = controlGroup ? normalizeKey(controlGroup.name) : '';
  const geneBase = new Map();
  rows.forEach(row => {
    const key = normalizeKey(row.gene || 'Gene');
    if (!geneBase.has(key)) geneBase.set(key, key === refKey ? 19.5 : 22 + geneBase.size * 1.2);
    const effect = key !== refKey && normalizeKey(row.group || '') !== controlKey ? -2 : 0;
    const base = geneBase.get(key) + effect;
    row.cts = row.cts.map(() => (base + (Math.random() - 0.5) * 0.24).toFixed(2));
  });
}

function renderAllRows() {
  renderRows(rows, replicateCount, experiment, els.body, els.head, {
    onReadRows: readRows, onRemoveRow: removeRow
  });
}

function readRows() {
  rows = readRowsFromDom(els.body, rows, experiment);
  save();
  calculate();
}

function removeRow(index) {
  rows.splice(index, 1);
  // Sync: remove corresponding block
  if (index < blocks.length) {
    blocks.splice(index, 1);
    if (blocks[0]) blocks[0].breakBefore = false;
  }
  // Regenerate well positions for remaining rows to match new plate layout
  latestPlate = generatePlacements();
  const placementsByBlock = new Map();
  latestPlate.placements.forEach(item => {
    if (!placementsByBlock.has(item.blockIndex)) placementsByBlock.set(item.blockIndex, []);
    placementsByBlock.get(item.blockIndex).push(item.well);
  });
  rows.forEach((row, i) => { row.wells = placementsByBlock.get(i) || []; });
  renderAllBlocks();
  renderAllRows();
  renderPlate();
  calculate();
  save();
}

function rowSlotCount(row) {
  const wellCount = (row.wells || []).filter(Boolean).length;
  return wellCount || Math.max(1, row.cts?.length || replicateCount);
}

// ---- Ct paste ----

function setCtPasteStatus(message, kind) {
  els.ctPasteStatus.textContent = message;
  els.ctPasteStatus.className = `paste-status ${kind ? `paste-status-${kind}` : ''}`;
}

/**
 * Try to parse Well + Ct value pairs from two-column clipboard data.
 * Format: "Pos\\tCp\\nA1\\t25.12\\nA2\\tUndetermined\\n..."
 * Returns Map<well, number|null> or null if no well+value pairs detected.
 */
function parseWellValuePairs(text) {
  const lines = String(text).replaceAll('\r', '').split('\n')
    .map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const missingPattern = /^(undetermined|undefined|no\s*cq|no\s*ct|no\s*cp|n\/a|na|nan|null|failed|invalid|—|–|-)$/i;
  const headerPattern = /^(pos|position|well|sample|ct|cq|cp|ct\s*value|cq\s*value|crossing\s*point|name)$/i;

  const map = new Map();
  let pairCount = 0;

  lines.forEach(line => {
    const parts = line.split('\t');
    if (parts.length < 2) return;
    const well = parts[0].trim().toUpperCase();
    if (!/^[A-P]\d{1,2}$/.test(well)) {
      // Skip known header columns without counting as failure
      if (headerPattern.test(parts[0].trim().toLowerCase())) return;
      return;
    }
    const ctText = parts[1].trim().replace(/^"|"$/g, '');

    if (missingPattern.test(ctText) || ctText === '') {
      map.set(well, null);
      pairCount += 1;
      return;
    }

    const normalized = ctText.replace(/，/g, ',').replace(',', '.');
    const parsed = parseCt(normalized);
    map.set(well, parsed.valid ? parsed.value : null);
    pairCount += 1;
  });

  return pairCount >= 1 ? map : null;
}

/**
 * Build a flat list of all Ct slots sorted by physical well position
 * (A1, A2, ..., B1, B2, ...).  This matches the order most instruments export.
 */
function buildWellSortedSlots() {
  const slots = [];
  rows.forEach((row, rowIndex) => {
    const count = rowSlotCount(row);
    for (let i = 0; i < count; i += 1) {
      const well = (row.wells && row.wells[i]) || '';
      const wellRow = well.charAt(0) || '￿';
      const wellCol = parseInt(well.slice(1), 10) || 9999;
      slots.push({ rowIndex, ctIndex: i, well, wellRow, wellCol });
    }
  });
  slots.sort((a, b) => {
    if (a.wellRow !== b.wellRow) return a.wellRow.localeCompare(b.wellRow);
    return a.wellCol - b.wellCol;
  });
  return slots;
}

function applyCtColumnText(text) {
  if (els.body.querySelector('tr[data-index]')) readRows();

  const slots = buildWellSortedSlots();
  const totalSlots = slots.length;
  if (!totalSlots) {
    setCtPasteStatus('当前数据表没有可填入的位置，请先应用点板模板。', 'warning');
    els.ctColumnPanel.classList.remove('hidden');
    return false;
  }

  // Clear all Ct values
  const clearCts = () => {
    rows = rows.map(row => ({ ...row, cts: Array(rowSlotCount(row)).fill('') }));
  };

  // Try well+value pair matching first (two-column clipboard data)
  const wellMap = parseWellValuePairs(text);
  if (wellMap) {
    clearCts();
    let filled = 0;
    let missing = 0;
    slots.forEach(slot => {
      if (wellMap.has(slot.well)) {
        const value = wellMap.get(slot.well);
        if (value !== null) {
          rows[slot.rowIndex].cts[slot.ctIndex] = String(value);
          filled += 1;
        }
      } else {
        missing += 1;
      }
    });

    renderAllRows();
    calculate();
    save();

    const extraWells = [...wellMap.keys()].filter(w => !slots.some(s => s.well === w)).length;
    let message = `已按孔号匹配填入 ${filled} / ${totalSlots} 个位置。`;
    if (missing) message += ` ${missing} 个孔位在数据中缺失。`;
    if (extraWells) message += ` ${extraWells} 个孔号不在当前模板中。`;
    setCtPasteStatus(message, missing || extraWells ? 'warning' : 'success');
    return true;
  }

  // Fallback: fill in physical well order (A1, A2, ..., B1, ...)
  const parsed = parseCtColumn(text);
  if (!parsed.values.length || !parsed.numeric) {
    setCtPasteStatus('没有识别到 Ct 数值，请检查剪贴板内容。', 'warning');
    els.ctColumnPanel.classList.remove('hidden');
    return false;
  }

  clearCts();
  for (let i = 0; i < slots.length && i < parsed.values.length; i += 1) {
    const value = parsed.values[i];
    if (value !== null) {
      rows[slots[i].rowIndex].cts[slots[i].ctIndex] = String(value);
    }
  }

  renderAllRows();
  calculate();
  save();

  const used = Math.min(parsed.values.length, totalSlots);
  const extra = Math.max(0, parsed.values.length - totalSlots);
  const mt = Math.max(0, totalSlots - parsed.values.length);
  let message = `已按物理孔序填入 ${used} / ${totalSlots} 个位置。`;
  if (mt) message += ` 后面 ${mt} 个位置保持空白。`;
  if (extra) message += ` 多出的 ${extra} 个值未使用。`;
  if (parsed.skipped) message += ` 已忽略 ${parsed.skipped} 行标题或非 Ct 内容。`;
  setCtPasteStatus(message, mt || extra ? 'warning' : 'success');
  return true;
}

async function pasteCtColumnFromClipboard() {
  els.ctColumnPanel.classList.remove('hidden');
  setCtPasteStatus('正在读取剪贴板…');
  try {
    if (!navigator.clipboard?.readText) throw new Error('Clipboard API unavailable');
    const text = await navigator.clipboard.readText();
    els.ctColumnArea.value = text;
    applyCtColumnText(text);
  } catch {
    setCtPasteStatus('浏览器未允许读取剪贴板，请在上方粘贴一竖列 Ct 后点击"填入当前数据表"。', 'warning');
    els.ctColumnArea.focus();
  }
}

// ---- Calculation ----

function calculate() {
  const refGeneId = experiment.refGene ? experiment.refGene.id : 'ref';
  const controlGroup = getControlGroup(experiment);
  const controlGroupId = controlGroup ? controlGroup.id : null;
  const maxSpread = Number(els.spread.value) || 0.5;
  const mode = els.mode.value;

  const result = computeAnalysis({ rows, experiment, mode, maxSpread });
  latest = result.results;
  latestNotes = result.notes;

  // Enrich results with display names
  latest.forEach(item => {
    item.group = item.group || resolveGroupName(experiment, item.groupId) || '';
    item.gene = item.gene || resolveGeneName(experiment, item.geneId) || '';
  });

  // Generate charts
  const groupOrder = (experiment.groups || []).map(g => g.name);
  const geneOrder = [...experiment.targetGenes.map(g => g.name), experiment.refGene?.name || 'GAPDH'];
  const chartHTML = resultsChartSvg(latest, groupOrder);
  const groupChartHTML = mode === 'ddct' ? groupChartSvg(latest, groupOrder, geneOrder) : '';

  // Build alerts
  const alertsHTML = buildAlertsHtml(latest, latestNotes, experiment, maxSpread);

  // Render results
  renderResults(latest, mode, experiment, result.controlStatsByGene, {
    desc: els.desc, formula: els.formula, summary: els.summary, alerts: els.alerts,
    chart: els.chart, groupChart: els.groupChart, results: els.results,
    spreadEl: els.spread,
    chartHTML, groupChartHTML, alertsHtml: alertsHTML
  });

  save();
}

// ---- Template import/export ----

function exportTemplate() {
  readBlocks();
  const plateSettings = {
    size: els.plateSize.value,
    startRow: els.startRow.value,
    startCol: els.startCol.value,
    direction: els.direction.value,
    gap: els.gap.value
  };
  const json = exportTemplateJson(blocks, experiment, replicateCount, plateSettings);
  downloadFile('qpcr-plate-template.json', json, 'application/json;charset=utf-8');
}

function importTemplate(file) {
  const reader = new FileReader();
  reader.onload = () => {
    // Snapshot current state before touching anything, so we can revert on overflow
    const preImportSnap = snapshotLayout();
    const preImportBlocks = blocks;
    const preImportExperiment = experiment;
    const preImportReps = replicateCount;

    try {
      const data = JSON.parse(reader.result);
      const list = Array.isArray(data) ? data : data?.blocks;
      if (!Array.isArray(list) || !list.length) throw new Error('invalid template');

      if (data.version >= 2 && data.replicateCount !== undefined) {
        replicateCount = normalizeReplicateCount(data.replicateCount);
      } else if (list.some(b => b.reps !== undefined)) {
        const repsValues = [...new Set(list.map(b => Number(b.reps) || 3))];
        replicateCount = (repsValues.length === 1 && repsValues[0] >= MIN_REPS && repsValues[0] <= MAX_REPS_GLOBAL)
          ? repsValues[0] : DEFAULT_REPS;
        if (repsValues.length > 1) window.alert('导入的旧模板包含混合复孔设置，已使用默认值 3。请确认模板布局后再应用。');
      }

      if (data.version >= 3 && data.experiment && Array.isArray(data.experiment.groups) && data.experiment.groups.length) {
        experiment = data.experiment;
        if (!experiment.refGene) experiment.refGene = { id: 'ref', name: 'GAPDH' };
        experiment.targetGenes = (experiment.targetGenes || []).map((g, i) =>
          typeof g === 'string' ? { id: 'tg' + (i + 1), name: g } : (g.id ? g : { ...g, id: 'tg' + (i + 1) })
        );
        if (!experiment.targetGenes.length) experiment.targetGenes = [{ id: 'tg1', name: 'IL6' }];
        experiment.groups = experiment.groups.map(g => g.id ? g : { ...g, id: 'g' + Date.now() });
      } else {
        experiment = createExperiment();
      }

      // Restore plate layout from template (v5+), keep current settings for older versions
      if (data.version >= 5 && data.plate && data.plate.size) {
        els.plateSize.value = PLATES[data.plate.size] ? data.plate.size : '96';
        refreshCoordinateSelects(data.plate.startRow || 'A', data.plate.startCol || '1');
        els.direction.value = data.plate.direction || 'horizontal';
        els.gap.value = data.plate.gap || '0';
      }

      blocks = list.map(normalizeBlock);
      if (blocks[0]) blocks[0].breakBefore = false;
      els.repsInput.value = String(replicateCount);

      // Check overflow BEFORE committing — revert everything if it fails
      latestPlate = generatePlacements();
      if (latestPlate.overflow) {
        blocks = preImportBlocks;
        experiment = preImportExperiment;
        replicateCount = preImportReps;
        els.repsInput.value = String(replicateCount);
        rollbackLayout(preImportSnap);
        latestPlate = generatePlacements();
        renderPlate();
        renderAllBlocks();
        window.alert(
          `导入的模板超出${currentPlate().label}容量（${blocks.length * replicateCount} 个孔），已恢复到导入前的设置。\n\n` +
          '请先切换到模板原有的孔板规格（96/384）或将起始孔设为 A1 后再导入。'
        );
        return;
      }

      renderGroups(experiment, { groupsContainer: els.groupsContainer, bioRepsInput: els.bioRepsInput,
        onRenameGroup: handleRenameGroup, onToggleControl: handleToggleControl, onRemoveGroup: handleRemoveGroup });
      targetCount();
      renderAllBlocks();
      rows = [];
      syncRowsFromBlocks();
      calculate();
      commitLayout(snapshotLayout());
      save();
    } catch {
      window.alert('无法导入：文件不是有效的点板模板 JSON。');
    }
  };
  reader.readAsText(file);
}

// ---- Experiment mutation handlers ----

function handleRenameGroup(groupId, newName) {
  experiment = expRenameGroup(experiment, groupId, newName);
  // Sync display names on blocks and rows
  blocks = syncBlockDisplayNames(blocks, experiment);
  rows = syncRowDisplayNames(rows, experiment);
  renderGroups(experiment, { groupsContainer: els.groupsContainer, bioRepsInput: els.bioRepsInput,
    onRenameGroup: handleRenameGroup, onToggleControl: handleToggleControl, onRemoveGroup: handleRemoveGroup });
  renderAllBlocks();
  renderAllRows();
  renderPlate();
  calculate();
}

function handleToggleControl(groupId) {
  experiment = expToggleControl(experiment, groupId);
  renderGroups(experiment, { groupsContainer: els.groupsContainer, bioRepsInput: els.bioRepsInput,
    onRenameGroup: handleRenameGroup, onToggleControl: handleToggleControl, onRemoveGroup: handleRemoveGroup });
  calculate();
}

function handleRemoveGroup(groupId) {
  try {
    if (experiment.groups.length <= 1) { window.alert('至少保留一个分组。'); return; }
    const target = experiment.groups.find(g => g.id === groupId);
    if (!target) return;
    const affectedBlocks = blocks.filter(b => b.groupId === groupId).length;
    const affectedRows = rows.filter(r => r.groupId === groupId).length;
    const parts = [];
    if (affectedBlocks) parts.push(`${affectedBlocks} 个区块`);
    if (affectedRows) parts.push(`${affectedRows} 行 Ct 数据`);
    const note = parts.length ? `\n\n关联数据：${parts.join('、')}，将一并删除。\n\n删除后孔板布局会变化，但其他分组已录入的 Ct 值会保留。` : '';
    if (!window.confirm(`确定删除分组"${target.name}"？${note}`)) return;
    // Cascade delete blocks by stable ID
    blocks = blocks.filter(b => b.groupId !== groupId);
    if (blocks[0]) blocks[0].breakBefore = false;
    experiment = expRemoveGroup(experiment, groupId);
    renderGroups(experiment, { groupsContainer: els.groupsContainer, bioRepsInput: els.bioRepsInput,
      onRenameGroup: handleRenameGroup, onToggleControl: handleToggleControl, onRemoveGroup: handleRemoveGroup });
    renderAllBlocks();
    // Rebuild the plate mapping while preserving Ct values for unchanged
    // (sample, groupId, geneId) rows. Rows belonging to the deleted group
    // are naturally omitted because their blocks no longer exist.
    syncRowsFromBlocks();
    renderPlate();
    calculate();
    save();
  } catch (e) {
    console.error('handleRemoveGroup error:', e);
  }
}

function handleRenameTargetGene(geneId, newName) {
  experiment = expRenameTargetGene(experiment, geneId, newName);
  blocks = syncBlockDisplayNames(blocks, experiment);
  rows = syncRowDisplayNames(rows, experiment);
  targetCount();
  renderAllBlocks();
  renderAllRows();
  renderPlate();
  calculate();
}

function handleRemoveTargetGene(geneId) {
  try {
    if (experiment.targetGenes.length <= 1) { window.alert('至少需要一个目标基因。'); return; }
    const target = experiment.targetGenes.find(g => g.id === geneId);
    const targetName = target ? target.name : geneId;
    const affectedBlocks = blocks.filter(b => b.geneId === geneId).length;
    const affectedRows = rows.filter(r => r.geneId === geneId).length;
    const parts = [];
    if (affectedBlocks) parts.push(`${affectedBlocks} 个区块`);
    if (affectedRows) parts.push(`${affectedRows} 行 Ct 数据`);
    const note = parts.length ? `\n\n关联数据：${parts.join('、')}，将一并删除。\n\n删除后孔板布局会变化，但其他基因已录入的 Ct 值会保留。` : '';
    if (!window.confirm(`确定删除目标基因"${targetName}"？${note}`)) return;
    // Cascade delete blocks by stable ID
    blocks = blocks.filter(b => b.geneId !== geneId);
    if (blocks[0]) blocks[0].breakBefore = false;
    experiment = expRemoveTargetGene(experiment, geneId);
    targetCount();
    renderAllBlocks();
    // Rebuild the plate mapping while preserving Ct values for unchanged
    // (sample, groupId, geneId) rows. Rows belonging to the deleted target
    // gene are naturally omitted because their blocks no longer exist.
    syncRowsFromBlocks();
    renderPlate();
    calculate();
    save();
  } catch (e) {
    console.error('handleRemoveTargetGene error:', e);
  }
}

function handleRenameRefGene(newName) {
  experiment = setRefGeneName(experiment, newName);
  blocks = syncBlockDisplayNames(blocks, experiment);
  rows = syncRowDisplayNames(rows, experiment);
  targetCount();
  renderAllBlocks();
  renderAllRows();
  calculate();
}

function handleAddGroup() {
  const name = (window.prompt('分组名称：') || '').trim();
  if (!name) return;
  if (experiment.groups.some(g => normalizeKey(g.name) === normalizeKey(name))) {
    window.alert('分组名称不能重复。'); return;
  }
  experiment = expAddGroup(experiment, name);
  renderGroups(experiment, { groupsContainer: els.groupsContainer, bioRepsInput: els.bioRepsInput,
    onRenameGroup: handleRenameGroup, onToggleControl: handleToggleControl, onRemoveGroup: handleRemoveGroup });
  save();
}

function handleAddTargetGene() {
  const max = maxTargetCount();
  if (experiment.targetGenes.length >= max) {
    window.alert(`当前孔板最多支持 ${max} 个目标基因。`); return;
  }
  const name = `Target-${experiment.targetGenes.length + 1}`;
  experiment = expAddTargetGene(experiment, name);
  targetCount();
  save();
}

// ---- Event bindings ----

$('#exampleTemplateBtn').addEventListener('click', () => {
  blocks = exampleTemplate();
  els.startRow.value = currentPlate().rows[0];
  els.startCol.value = '1';
  els.direction.value = 'horizontal';
  els.gap.value = '0';
  renderAllBlocks();
  renderPlate();
  syncRowsFromBlocks();
  fillExampleCts();
  renderAllRows();
  calculate();
});

// els.targets is type="hidden" — its value is maintained by targetCount().
// No event handlers needed; programmatic value changes don't fire input/change events.

$('#clearBlocksBtn').addEventListener('click', () => {
  readBlocks();
  readRows();
  if (!blocks.length && !rows.length) return;
  const enteredCtCount = rows.reduce((count, row) =>
    count + (row.cts || []).filter(ct => String(ct ?? '').trim() !== '').length, 0);
  const ctNote = enteredCtCount ? `，包括 ${enteredCtCount} 个已录入 Ct 值` : '';
  if (!window.confirm(`确定清空全板？将删除 ${blocks.length} 个区块和 ${rows.length} 行 Ct 数据${ctNote}。此操作无法撤销。`)) return;
  blocks = [];
  rows = [];
  renderAllBlocks();
  renderPlate();
  renderAllRows();
  calculate();
});
$('#loadPresetBtn').addEventListener('click', loadPreset);

$('#addBlockBtn').addEventListener('click', () => {
  readBlocks();
  const block = blankBlock();
  block.sample = uniqueSampleName(block.sample);
  blocks.push(block);
  if (generatePlacements().overflow) { blocks.pop(); window.alert(`${currentPlate().label}空间不足，无法继续添加区块。`); }
  renderAllBlocks();
  renderPlate();
  syncRowsFromBlocks();
  calculate();
  save();
});

$('#exportPlateBtn').addEventListener('click', () => {
  downloadFile(`qpcr-${currentPlate().size}-well-plate-plan.csv`, plateCsv(latestPlate.placements, currentPlate().size));
});
$('#exportTemplateBtn').addEventListener('click', exportTemplate);
$('#importTemplateBtn').addEventListener('click', () => $('#templateFileInput').click());
$('#templateFileInput').addEventListener('change', event => {
  const file = event.target.files[0];
  if (file) importTemplate(file);
  event.target.value = '';
});

els.plateSize.addEventListener('change', () => {
  refreshCoordinateSelects(els.startRow.value, els.startCol.value);
  syncPlateLayout();
});
[els.startRow, els.startCol, els.direction, els.gap].forEach(el =>
  el.addEventListener('change', syncPlateLayout)
);

els.addGroupBtn.addEventListener('click', handleAddGroup);
els.addTargetGeneBtn.addEventListener('click', handleAddTargetGene);

els.bioRepsInput.addEventListener('change', () => {
  experiment.biologicalReplicates = Math.max(1, Math.min(24, Number(els.bioRepsInput.value) || 1));
  els.bioRepsInput.value = String(experiment.biologicalReplicates);
  els.targets.max = String(maxTargetCount());
  targetCount(); save();
});

els.bioGroupReplicates.addEventListener('change', () => {
  blocks = buildTemplate();
  renderAllBlocks(); renderPlate(); syncRowsFromBlocks(); calculate(); save();
});

els.repsInput.addEventListener('change', () => {
  const oldCount = replicateCount;
  replicateCount = normalizeReplicateCount(els.repsInput.value);
  els.repsInput.value = String(replicateCount);
  if (oldCount === replicateCount) return;

  // Confirm data loss when reducing replicate count
  if (replicateCount < oldCount && rows.length) {
    const lostCts = rows.some(row =>
      (row.cts || []).slice(replicateCount).some(ct => String(ct ?? '').trim() !== '')
    );
    if (lostCts && !window.confirm(`复孔数量从 ${oldCount} 减少到 ${replicateCount}，Ct${replicateCount + 1}–Ct${oldCount} 中已有数据将被移除。确认继续？`)) {
      replicateCount = oldCount;
      els.repsInput.value = String(oldCount);
      return;
    }
  }

  blocks.forEach(b => { b.reps = replicateCount; });
  toggleBioGroupVisibility();
  els.targets.max = String(maxTargetCount());
  targetCount();
  renderAllBlocks();
  syncPlateLayout();
});

$('#addSampleBtn').addEventListener('click', () => { readRows(); rows.push(blankRow()); renderAllRows(); calculate(); });
$('#exampleDataBtn').addEventListener('click', () => { readRows(); fillExampleCts(); renderAllRows(); calculate(); });
$('#clearDataBtn').addEventListener('click', () => {
  readRows();
  const enteredCtCount = rows.reduce((count, row) =>
    count + (row.cts || []).filter(ct => String(ct ?? '').trim() !== '').length, 0);
  if (enteredCtCount && !window.confirm(`确定清空 ${enteredCtCount} 个已录入的 Ct 值？样本、分组、基因和孔位将保留。`)) return;
  if (!rows.length && blocks.length) syncRowsFromBlocks();
  rows = rows.map(row => ({ ...row, cts: Array(rowSlotCount(row)).fill('') }));
  renderAllRows();
  calculate();
});

$('#resetBtn').addEventListener('click', () => {
  if (!window.confirm('确定恢复默认设置？当前模板、Ct 数据和本地保存内容将被清除。此操作无法撤销。')) return;
  localStorage.removeItem(KEY);
  LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
  replicateCount = DEFAULT_REPS;
  els.repsInput.value = String(DEFAULT_REPS);
  experiment = createExperiment();
  els.targets.value = '1'; els.bioGroupReplicates.checked = false;
  toggleBioGroupVisibility();
  els.plateSize.value = '96';
  refreshCoordinateSelects('A', '1');
  els.direction.value = 'horizontal'; els.gap.value = '0';
  els.mode.value = 'ddct'; els.spread.value = '0.5';
  blocks = buildTemplate();
  rows = [];
  els.ctColumnArea.value = '';
  els.ctColumnPanel.classList.add('hidden');
  els.paste.classList.add('hidden');
  renderGroups(experiment, { groupsContainer: els.groupsContainer, bioRepsInput: els.bioRepsInput,
    onRenameGroup: handleRenameGroup, onToggleControl: handleToggleControl, onRemoveGroup: handleRemoveGroup });
  targetCount();
  commitLayout(snapshotLayout());
  renderAllBlocks();
  renderPlate();
  syncRowsFromBlocks();
  calculate();
});

$('#pasteColumnBtn').addEventListener('click', pasteCtColumnFromClipboard);
$('#applyCtColumnBtn').addEventListener('click', () => applyCtColumnText(els.ctColumnArea.value));
$('#closeCtColumnBtn').addEventListener('click', () => els.ctColumnPanel.classList.add('hidden'));
$('#pasteBtn').addEventListener('click', () => els.paste.classList.toggle('hidden'));
els.paste.addEventListener('input', () => {
  const parsed = parseFullTable(els.paste.value, currentPlate(), replicateCount);
  if (parsed.length) {
    rows = parsed.map(r => ({
      ...r,
      groupId: resolveGroupId(experiment, r.group).id,
      geneId: resolveGeneId(experiment, r.gene).id
    }));
    renderAllRows(); calculate();
  }
});

$('#copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(resultsCsv(latest, els.mode.value)); }
  catch { window.alert('浏览器未允许复制，请使用"导出 CSV"。'); }
});
$('#exportBtn').addEventListener('click', () => downloadFile('qpcr-results.csv', resultsCsv(latest, els.mode.value)));

[els.mode, els.spread].forEach(el => el.addEventListener('input', calculate));

// ---- Init ----
refreshCoordinateSelects('A', '1');
load();
toggleBioGroupVisibility();
if (!hasSavedState && blocks.length === 0) blocks = buildTemplate();
renderAllBlocks();
renderPlate();
if (blocks.length && rows.length === 0) syncRowsFromBlocks();
else renderAllRows();
calculate();
