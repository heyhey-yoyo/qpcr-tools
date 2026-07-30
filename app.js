'use strict';

const KEY = 'qpcr-demo-v4';
const LEGACY_KEY = 'qpcr-demo-v3';
const MAX_REPS = 12;
const DEFAULT_REPS = 3;
const MIN_REPS = 1;
const MAX_REPS_GLOBAL = 6;
const PLATES = {
  '96': { size: '96', rows: 'ABCDEFGH'.split(''), cols: 12, label: '96 孔板' },
  '384': { size: '384', rows: 'ABCDEFGHIJKLMNOP'.split(''), cols: 24, label: '384 孔板' }
};
const $ = selector => document.querySelector(selector);

const els = {
  blocksBody: $('#blocksBody'),
  plateGrid: $('#plateGrid'),
  plateLegend: $('#plateLegend'),
  plateAlert: $('#plateAlert'),
  targets: $('#targetCount'),
  appendCount: $('#appendCount'),
  appendNewLine: $('#appendNewLine'),
  plateSize: $('#plateSize'),
  startRow: $('#startRow'),
  startCol: $('#startCol'),
  direction: $('#plateDirection'),
  gap: $('#blockGap'),
  body: $('#samplesBody'),
  head: $('#samplesHead'),
  mode: $('#workflowSelect'),
  ref: $('#referenceGene'),
  control: $('#controlGroup'),
  spread: $('#maxSpread'),
  geneList: $('#geneList'),
  groupList: $('#groupList'),
  desc: $('#modeDescription'),
  formula: $('#formulaNote'),
  summary: $('#summary'),
  alerts: $('#alerts'),
  results: $('#resultsBody'),
  chart: $('#resultsChart'),
  paste: $('#pasteArea'),
  ctColumnPanel: $('#ctColumnPanel'),
  ctColumnArea: $('#ctColumnArea'),
  ctPasteStatus: $('#ctPasteStatus'),
  repsInput: $('#replicateCount')
};

// Build a plate template: 2 samples (NC / Treatment) × N targets + 1 fixed
// reference. N is bounded by maxTargetCount().
function buildTemplate(count) {
  const template = [];
  [['NC-1', 'NC'], ['Treat-1', 'Treatment']].forEach(([sample, group]) => {
    for (let index = 1; index <= count; index += 1) {
      template.push({ sample, group, gene: `Target-${index}`, role: 'target', reps: replicateCount, breakBefore: false });
    }
    template.push({ sample, group, gene: 'GAPDH', role: 'reference', reps: replicateCount, breakBefore: false });
  });
  return template;
}

function maxTargetCount() {
  const plate = currentPlate();
  return Math.max(1, Math.floor((plate.rows.length * plate.cols) / (2 * replicateCount)) - 1);
}

// Demo template for the current plate size: two batches (NC-x / Treat-x) of
// targets + 1 reference, second batch starts on a fresh row.
function exampleTemplate() {
  const plate = currentPlate();
  const targets = plate.size === '384' ? 7 : 3;
  const template = [];
  [1, 2].forEach(batch => {
    [['NC', `NC-${batch}`], ['Treatment', `Treat-${batch}`]].forEach(([group, sample]) => {
      for (let index = 1; index <= targets; index += 1) {
        template.push({ sample, group, gene: `Target-${index}`, role: 'target', reps: replicateCount, breakBefore: false });
      }
      template.push({ sample, group, gene: 'GAPDH', role: 'reference', reps: replicateCount, breakBefore: false });
    });
  });
  template[(targets + 1) * 2].breakBefore = true;
  return template;
}

function targetCount() {
  const value = Math.max(1, Math.min(maxTargetCount(), Number(els.targets.value) || 1));
  els.targets.value = String(value);
  return value;
}

const exampleRows = [
  { wells: ['A1', 'A2', 'A3'], name: 'NC-1', group: 'NC', gene: 'IL6', cts: [25.12, 25.30, 25.21] },
  { wells: ['A4', 'A5', 'A6'], name: 'NC-1', group: 'NC', gene: 'GAPDH', cts: [19.91, 20.02, 19.96] },
  { wells: ['A7', 'A8', 'A9'], name: 'Treat-1', group: 'Treatment', gene: 'IL6', cts: [22.45, 22.53, 22.49] },
  { wells: ['A10', 'A11', 'A12'], name: 'Treat-1', group: 'Treatment', gene: 'GAPDH', cts: [20.14, 20.19, 20.11] }
];

let replicateCount = DEFAULT_REPS;
let blocks = buildTemplate(1);
let rows = clone(exampleRows);
let latest = [];
let latestNotes = { merged: [], singleRep: [] };
let latestPlate = { placements: [], overflow: false };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeReplicateCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < MIN_REPS) return DEFAULT_REPS;
  return Math.min(MAX_REPS_GLOBAL, Math.max(MIN_REPS, Math.round(num)));
}

function resizeReplicates(rows, oldCount, newCount) {
  if (oldCount === newCount) return rows;
  if (newCount > oldCount) {
    return rows.map(row => ({
      ...row,
      cts: [...row.cts, ...Array(newCount - oldCount).fill('')],
      wells: [...(row.wells || []), ...Array(Math.max(0, newCount - (row.wells || []).length)).fill('')]
    }));
  }
  // newCount < oldCount: check for data loss in truncated Ct values
  const lostCts = rows.some(row =>
    (row.cts || []).slice(newCount).some(ct => String(ct ?? '').trim() !== '')
  );
  if (lostCts && !window.confirm(
    `复孔数量从 ${oldCount} 减少到 ${newCount}，Ct${newCount + 1}–Ct${oldCount} 中已有数据将被移除。确认继续？`
  )) {
    return null;
  }
  return rows.map(row => ({
    ...row,
    cts: (row.cts || []).slice(0, newCount),
    wells: (row.wells || []).slice(0, newCount)
  }));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function currentPlate() {
  return PLATES[els.plateSize.value] || PLATES['96'];
}

function refreshCoordinateSelects(preferredRow = els.startRow.value, preferredCol = els.startCol.value) {
  const plate = currentPlate();
  els.startRow.innerHTML = plate.rows.map(row => `<option value="${row}">${row}</option>`).join('');
  els.startCol.innerHTML = Array.from({ length: plate.cols }, (_, index) => index + 1)
    .map(col => `<option value="${col}">${col}</option>`).join('');
  els.startRow.value = plate.rows.includes(preferredRow) ? preferredRow : plate.rows[0];
  const colNumber = Number(preferredCol);
  els.startCol.value = colNumber >= 1 && colNumber <= plate.cols ? String(colNumber) : '1';
  els.targets.max = String(maxTargetCount());
  targetCount();
}

function blankBlock() {
  return { sample: 'Sample-1', group: 'Treatment', gene: 'IL6', role: 'target', reps: replicateCount, breakBefore: false };
}

function normalizeBlock(block) {
  return {
    sample: block?.sample || 'Sample-1',
    group: block?.group || 'Treatment',
    gene: block?.gene || 'IL6',
    role: block?.role === 'reference' ? 'reference' : 'target',
    reps: Math.max(MIN_REPS, Math.min(MAX_REPS_GLOBAL, Number(block?.reps) || replicateCount)),
    breakBefore: Boolean(block?.breakBefore)
  };
}

function blankRow() {
  return { wells: Array(replicateCount).fill(''), name: 'Sample-1', group: 'NC', gene: 'GAPDH', cts: Array(replicateCount).fill('') };
}

function normalizeRow(row) {
  const cts = Array.isArray(row?.cts) ? row.cts : Array(replicateCount).fill('');
  const wells = Array.isArray(row?.wells) ? row.wells : [];
  return {
    wells: wells.length ? wells : Array(cts.length || replicateCount).fill(''),
    name: row?.name || 'Sample-1',
    group: row?.group || 'NC',
    gene: row?.gene || 'GAPDH',
    cts: cts.length ? cts : Array(replicateCount).fill('')
  };
}

function save() {
  localStorage.setItem(KEY, JSON.stringify({
    blocks,
    rows,
    replicateCount,
    plate: {
      size: els.plateSize.value,
      startRow: els.startRow.value,
      startCol: els.startCol.value,
      direction: els.direction.value,
      gap: els.gap.value,
      targets: els.targets.value,
      appendCount: els.appendCount.value,
      appendNewLine: els.appendNewLine.checked
    },
    mode: els.mode.value,
    ref: els.ref.value,
    control: els.control.value,
    spread: els.spread.value
  }));
}

function load() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
    const state = raw ? JSON.parse(raw) : null;
    if (!state) {
      refreshCoordinateSelects('A', '1');
      return;
    }
    // Restore replicateCount before normalizing blocks/rows (they depend on it)
    if (state.replicateCount !== undefined) {
      replicateCount = normalizeReplicateCount(state.replicateCount);
    } else if (Array.isArray(state.blocks) && state.blocks.length) {
      const repsValues = [...new Set(state.blocks.map(b => Number(b.reps) || 3))];
      replicateCount = repsValues.length === 1 && repsValues[0] >= MIN_REPS && repsValues[0] <= MAX_REPS_GLOBAL
        ? repsValues[0]
        : DEFAULT_REPS;
    } else {
      replicateCount = DEFAULT_REPS;
    }
    blocks = Array.isArray(state.blocks) ? state.blocks.map(normalizeBlock) : buildTemplate(1);
    rows = Array.isArray(state.rows) ? state.rows.map(normalizeRow) : clone(exampleRows);
    els.repsInput.value = String(replicateCount);
    const plateSize = PLATES[state.plate?.size] ? state.plate.size : '96';
    els.plateSize.value = plateSize;
    refreshCoordinateSelects(state.plate?.startRow || 'A', state.plate?.startCol || '1');
    els.direction.value = state.plate?.direction || 'horizontal';
    els.gap.value = state.plate?.gap || '0';
    els.targets.value = String(Number(state.plate?.targets) || 1);
    targetCount();
    els.appendCount.value = String(Math.max(1, Math.min(24, Number(state.plate?.appendCount) || 1)));
    els.appendNewLine.checked = Boolean(state.plate?.appendNewLine);
    els.mode.value = state.mode || 'ddct';
    els.ref.value = state.ref || 'GAPDH';
    els.control.value = state.control || 'NC';
    els.spread.value = state.spread || 0.5;
  } catch (error) {
    console.warn('无法读取本地数据：', error);
    refreshCoordinateSelects('A', '1');
  }
}

function refreshOptionLists() {
  const genes = [...new Set([...blocks.map(block => block.gene), ...rows.map(row => row.gene)].filter(Boolean))];
  const groups = [...new Set([...blocks.map(block => block.group), ...rows.map(row => row.group)].filter(Boolean))];
  els.geneList.innerHTML = genes.map(gene => `<option value="${escapeHtml(gene)}"></option>`).join('');
  els.groupList.innerHTML = groups.map(group => `<option value="${escapeHtml(group)}"></option>`).join('');
}

function renderBlocks() {
  refreshOptionLists();
  if (!blocks.length) {
    els.blocksBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:22px">当前是空模板，请载入预设或添加点板区块。</td></tr>';
    return;
  }

  els.blocksBody.innerHTML = blocks.map((block, index) => `
    <tr data-index="${index}">
      <td><input class="break-toggle" data-field="breakBefore" type="checkbox" ${block.breakBefore ? 'checked' : ''} ${index === 0 ? 'disabled' : ''} title="从新的一行开始" /></td>
      <td><input data-field="sample" value="${escapeHtml(block.sample)}" /></td>
      <td><input data-field="group" value="${escapeHtml(block.group)}" /></td>
      <td><input data-field="gene" value="${escapeHtml(block.gene)}" /></td>
      <td><select data-field="role"><option value="target" ${block.role === 'target' ? 'selected' : ''}>目标</option><option value="reference" ${block.role === 'reference' ? 'selected' : ''}>内参</option></select></td>
      <td class="action-col"><div class="block-actions">
        <button class="icon-button move-up" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-button move-down" title="下移" ${index === blocks.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-button danger remove-block" title="删除">×</button>
      </div></td>
    </tr>`).join('');

  els.blocksBody.querySelectorAll('input,select').forEach(control => {
    control.addEventListener('input', readBlocks);
    control.addEventListener('change', readBlocks);
  });
  els.blocksBody.querySelectorAll('.move-up').forEach(button => button.addEventListener('click', moveBlock));
  els.blocksBody.querySelectorAll('.move-down').forEach(button => button.addEventListener('click', moveBlock));
  els.blocksBody.querySelectorAll('.remove-block').forEach(button => button.addEventListener('click', removeBlock));
}

function readBlocks() {
  blocks = [...els.blocksBody.querySelectorAll('tr[data-index]')].map(row => ({
    breakBefore: row.querySelector('[data-field="breakBefore"]').checked,
    sample: row.querySelector('[data-field="sample"]').value.trim(),
    group: row.querySelector('[data-field="group"]').value.trim(),
    gene: row.querySelector('[data-field="gene"]').value.trim(),
    role: row.querySelector('[data-field="role"]').value,
    reps: replicateCount
  }));
  if (blocks[0]) blocks[0].breakBefore = false;
  renderPlate();
  save();
}

function moveBlock(event) {
  readBlocks();
  const index = Number(event.currentTarget.closest('tr').dataset.index);
  const nextIndex = event.currentTarget.classList.contains('move-up') ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= blocks.length) return;
  [blocks[index], blocks[nextIndex]] = [blocks[nextIndex], blocks[index]];
  if (blocks[0]) blocks[0].breakBefore = false;
  renderBlocks();
  renderPlate();
  save();
}

function removeBlock(event) {
  readBlocks();
  const index = Number(event.currentTarget.closest('tr').dataset.index);
  blocks.splice(index, 1);
  if (blocks[0]) blocks[0].breakBefore = false;
  renderBlocks();
  renderPlate();
  save();
}

function sampleParts(name) {
  const match = String(name).match(/^(.*?)(\d+)$/);
  return match ? { prefix: match[1], number: Number(match[2]) } : null;
}

function uniqueSampleName(original) {
  const names = blocks.map(block => block.sample);
  if (!names.includes(original)) return original;
  const parts = sampleParts(original);
  if (parts) {
    const maxNumber = names.reduce((max, name) => {
      const candidate = sampleParts(name);
      return candidate && candidate.prefix === parts.prefix ? Math.max(max, candidate.number) : max;
    }, parts.number);
    return `${parts.prefix}${maxNumber + 1}`;
  }
  let number = 2;
  while (names.includes(`${original}-${number}`)) number += 1;
  return `${original}-${number}`;
}

function appendPreset() {
  readBlocks();
  const preset = buildTemplate(targetCount());
  const copies = Math.max(1, Math.min(24, Number(els.appendCount?.value) || 1));

  if (generatePlacements().overflow) {
    window.alert(`当前模板已超出${currentPlate().label}容量，请先调整布局再追加。`);
    return;
  }

  const startIndex = blocks.length;
  for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
    const template = clone(preset);
    const sampleMap = new Map();
    template.forEach(block => {
      if (!sampleMap.has(block.sample)) sampleMap.set(block.sample, uniqueSampleName(block.sample));
    });
    template.forEach((block, templateIndex) => {
      block.sample = sampleMap.get(block.sample);
      block.breakBefore = Boolean(els.appendNewLine.checked && templateIndex === 0 && blocks.length);
      blocks.push(normalizeBlock(block));
    });
  }

  if (blocks.length) blocks[0].breakBefore = false;
  if (generatePlacements().overflow) {
    blocks.splice(startIndex);
    window.alert(`${currentPlate().label}空间不足，本次未追加。可减少追加份数、取消“每份另起一行”，或改用更大孔板。`);
  }
  renderBlocks();
  renderPlate();
  save();
}

function generatePlacements() {
  const plate = currentPlate();
  const direction = els.direction.value;
  const gap = Number(els.gap.value) || 0;
  const baseRow = Math.max(0, plate.rows.indexOf(els.startRow.value));
  const baseCol = Math.max(0, Number(els.startCol.value) - 1);
  let row = baseRow;
  let col = baseCol;
  const placements = [];
  let overflow = false;

  const advance = () => {
    if (direction === 'horizontal') {
      col += 1;
      if (col >= plate.cols) {
        row += 1;
        col = 0;
      }
    } else {
      row += 1;
      if (row >= plate.rows.length) {
        col += 1;
        row = 0;
      }
    }
  };

  const advanceGap = () => {
    for (let index = 0; index < gap; index += 1) advance();
  };

  blocks.forEach((block, blockIndex) => {
    if (block.breakBefore && blockIndex > 0) {
      const previous = placements[placements.length - 1];
      if (direction === 'horizontal') {
        // If the previous block ended exactly at the right edge, the cursor has
        // already wrapped to a fresh row; do not skip an extra row.
        if (previous && previous.row === row) row += 1;
        col = baseCol;
      } else {
        // Same rule for vertical layouts: avoid skipping a column after an
        // automatic wrap at the bottom edge.
        if (previous && previous.col === col) col += 1;
        row = baseRow;
      }
    }

    for (let rep = 0; rep < replicateCount; rep += 1) {
      if (row < 0 || col < 0 || row >= plate.rows.length || col >= plate.cols) {
        overflow = true;
        continue;
      }
      placements.push({
        well: `${plate.rows[row]}${col + 1}`,
        row,
        col,
        blockIndex,
        rep: rep + 1,
        sample: block.sample || `Sample-${blockIndex + 1}`,
        group: block.group || '未分组',
        gene: block.gene || 'Gene',
        role: block.role || 'target'
      });
      advance();
    }
    if (blockIndex < blocks.length - 1 && !blocks[blockIndex + 1].breakBefore) advanceGap();
  });

  return { placements, overflow };
}

function parseWell(value) {
  const plate = currentPlate();
  const match = String(value).trim().toUpperCase().match(/^([A-P])(\d{1,2})$/);
  if (!match) return null;
  const row = match[1];
  const col = Number(match[2]);
  if (!plate.rows.includes(row) || col < 1 || col > plate.cols) return null;
  return { row, col };
}

// Split placements into contiguous runs (same block, same row or column) so
// each run can be wrapped in a group container on the plate preview.
function plateSegments(placements) {
  const segments = [];
  let current = null;
  const flush = () => {
    if (current) segments.push(current);
    current = null;
  };
  placements.forEach(item => {
    if (current && current.blockIndex === item.blockIndex) {
      if (!current.axis) {
        if (item.row === current.row && item.col === current.col + 1) {
          current.axis = 'h';
          current.span = 2;
          current.items.push(item);
          return;
        }
        if (item.col === current.col && item.row === current.row + 1) {
          current.axis = 'v';
          current.span = 2;
          current.items.push(item);
          return;
        }
      } else if (current.axis === 'h' && item.row === current.row && item.col === current.col + current.span) {
        current.span += 1;
        current.items.push(item);
        return;
      } else if (current.axis === 'v' && item.col === current.col && item.row === current.row + current.span) {
        current.span += 1;
        current.items.push(item);
        return;
      }
    }
    flush();
    current = { blockIndex: item.blockIndex, axis: null, row: item.row, col: item.col, span: 1, items: [item] };
  });
  flush();
  return segments;
}

function renderPlate() {
  const plate = currentPlate();
  latestPlate = generatePlacements();
  const groups = [...new Set(latestPlate.placements.map(item => item.group))];
  const groupClass = group => `group-${Math.max(0, groups.indexOf(group)) % 6}`;

  els.plateGrid.className = `plate-grid plate-${plate.size}`;
  els.plateGrid.style.setProperty('--plate-cols', String(plate.cols));
  els.plateGrid.style.setProperty('--plate-rows', String(plate.rows.length));

  const segments = plateSegments(latestPlate.placements);
  const segmentStart = new Map(segments.map(segment => [`${segment.row},${segment.col}`, segment]));
  const covered = new Set();
  segments.forEach(segment => segment.items.slice(1).forEach(item => covered.add(`${item.row},${item.col}`)));

  const wellHtml = item => `<div class="plate-well ${groupClass(item.group)} ${item.role === 'reference' ? 'reference' : ''}" title="${escapeHtml(item.sample)} · ${escapeHtml(item.group)} · ${escapeHtml(item.gene)} · 重复 ${item.rep}">
      <span class="well-id">${item.well}</span>
      <span class="well-role">${item.role === 'reference' ? '内参' : `R${item.rep}`}</span>
      <span class="well-sample">${escapeHtml(item.sample)}</span>
      <span class="well-gene">${escapeHtml(item.gene)}</span>
    </div>`;

  let html = '<div class="plate-corner" style="grid-row:1;grid-column:1"></div>';
  html += Array.from({ length: plate.cols }, (_, index) => index + 1)
    .map(col => `<div class="plate-col-label" style="grid-row:1;grid-column:${col + 1}">${col}</div>`).join('');

  plate.rows.forEach((row, rowIndex) => {
    html += `<div class="plate-row-label" style="grid-row:${rowIndex + 2};grid-column:1">${row}</div>`;
    for (let colIndex = 0; colIndex < plate.cols; colIndex += 1) {
      const key = `${rowIndex},${colIndex}`;
      const segment = segmentStart.get(key);
      if (segment) {
        const placement = segment.axis === 'v'
          ? `grid-row:${rowIndex + 2} / span ${segment.span};grid-column:${colIndex + 2}`
          : `grid-row:${rowIndex + 2};grid-column:${colIndex + 2} / span ${segment.span}`;
        html += `<div class="well-group${segment.axis === 'v' ? ' vertical' : ''}" style="${placement}">${segment.items.map(wellHtml).join('')}</div>`;
      } else if (!covered.has(key)) {
        const well = `${row}${colIndex + 1}`;
        html += `<button type="button" class="plate-well empty" data-well="${well}" style="grid-row:${rowIndex + 2};grid-column:${colIndex + 2}" title="点击将此孔设为模板起点"><span class="well-id">${well}</span></button>`;
      }
    }
  });

  els.plateGrid.innerHTML = html;
  els.plateGrid.querySelectorAll('.plate-well.empty').forEach(button => {
    button.addEventListener('click', () => {
      const well = parseWell(button.dataset.well);
      if (!well) return;
      els.startRow.value = well.row;
      els.startCol.value = String(well.col);
      renderPlate();
      save();
    });
  });

  els.plateLegend.innerHTML = groups.map((group, index) => `<span class="legend-item"><span class="legend-dot group-${index % 6}"></span>${escapeHtml(group)}</span>`).join('') +
    (latestPlate.placements.length ? '<span class="legend-item"><span class="legend-line"></span>虚线边框 = 内参</span><span class="legend-item"><span class="legend-frame"></span>浅框 = 同一区块（一组技术重复）</span>' : '');

  const total = blocks.length * replicateCount;
  if (latestPlate.overflow) {
    els.plateAlert.innerHTML = `<div class="alert alert-warning">模板需要 ${total} 个孔，但当前位置无法全部放入 ${plate.label}。请提前起始位置、减少空孔或调整“另起一行”。</div>`;
  } else if (blocks.length) {
    els.plateAlert.innerHTML = `<div class="alert alert-success">${plate.label}已规划 ${latestPlate.placements.length} 个孔、${blocks.length} 个区块。可继续点击“追加模板”。</div>`;
  } else {
    els.plateAlert.innerHTML = '<div class="alert alert-warning">当前模板为空。</div>';
  }
}

function applyPlateToRows() {
  readBlocks();
  latestPlate = generatePlacements();
  if (!blocks.length) {
    window.alert('当前模板为空，请先载入或追加模板。');
    return;
  }
  if (latestPlate.overflow) {
    window.alert(`模板超出${currentPlate().label}，暂不能应用。请先调整起始位置或布局。`);
    return;
  }

  const placementsByBlock = new Map();
  latestPlate.placements.forEach(item => {
    if (!placementsByBlock.has(item.blockIndex)) placementsByBlock.set(item.blockIndex, []);
    placementsByBlock.get(item.blockIndex).push(item.well);
  });

  rows = blocks.map((block, index) => {
    const wells = placementsByBlock.get(index) || [];
    return {
      wells,
      name: block.sample,
      group: block.group,
      gene: block.gene,
      cts: Array(wells.length).fill('')
    };
  });

  const referenceBlock = blocks.find(block => block.role === 'reference');
  const firstGroup = blocks[0]?.group;
  if (referenceBlock) els.ref.value = referenceBlock.gene;
  if (firstGroup) els.control.value = firstGroup;
  renderRows();
  calculate();
  save();
  document.querySelector('.samples-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Fill fabricated Ct values: reference ~19.5, targets staggered higher;
// non-control targets read ~2 Ct lower (about 4x up-regulation in the demo).
function fillExampleCts() {
  const ref = els.ref.value.trim().toLowerCase();
  const control = els.control.value.trim().toLowerCase();
  const geneBase = new Map();
  rows.forEach(row => {
    const key = (row.gene || 'Gene').toLowerCase();
    if (!geneBase.has(key)) geneBase.set(key, key === ref ? 19.5 : 22 + geneBase.size * 1.2);
    const effect = key !== ref && (row.group || '').toLowerCase() !== control ? -2 : 0;
    const base = geneBase.get(key) + effect;
    row.cts = row.cts.map(() => (base + (Math.random() - 0.5) * 0.24).toFixed(2));
  });
}

function renderRows() {
  refreshOptionLists();
  const maxReps = Math.max(replicateCount, ...rows.map(row => Math.max(row.cts?.length || 0, row.wells?.length || 0)));
  els.head.innerHTML = `<tr><th>孔位</th><th>样本名称</th><th>组别</th><th>基因</th>${Array.from({ length: maxReps }, (_, index) => `<th>Ct ${index + 1}</th>`).join('')}<th class="action-col">操作</th></tr>`;

  els.body.innerHTML = rows.map((row, index) => {
    const normalized = normalizeRow(row);
    while (normalized.cts.length < maxReps) normalized.cts.push('');
    const wellsText = normalized.wells.filter(Boolean).join(', ');
    const ctInputs = normalized.cts.slice(0, maxReps)
      .map((value, ctIndex) => `<td><input class="ct-input" data-ct="${ctIndex}" type="number" step="0.01" value="${escapeHtml(value)}" /></td>`).join('');
    return `<tr data-index="${index}">
      <td><input class="wells-input" data-field="wells" value="${escapeHtml(wellsText)}" /></td>
      <td><input data-field="name" value="${escapeHtml(normalized.name)}" /></td>
      <td><input data-field="group" value="${escapeHtml(normalized.group)}" /></td>
      <td><input data-field="gene" value="${escapeHtml(normalized.gene)}" /></td>
      ${ctInputs}
      <td class="action-col"><button class="icon-button danger remove-row" title="删除">×</button></td>
    </tr>`;
  }).join('');

  els.body.querySelectorAll('input').forEach(input => input.addEventListener('input', readRows));
  els.body.querySelectorAll('.remove-row').forEach(button => button.addEventListener('click', event => {
    const index = Number(event.currentTarget.closest('tr').dataset.index);
    rows.splice(index, 1);
    renderRows();
    calculate();
  }));
}

function readRows() {
  rows = [...els.body.querySelectorAll('tr[data-index]')].map(row => ({
    wells: row.querySelector('[data-field="wells"]').value
      .split(/[,，\s]+/).map(value => value.trim().toUpperCase()).filter(Boolean),
    name: row.querySelector('[data-field="name"]').value.trim(),
    group: row.querySelector('[data-field="group"]').value.trim(),
    gene: row.querySelector('[data-field="gene"]').value.trim(),
    cts: [...row.querySelectorAll('[data-ct]')].map(input => input.value)
  }));
  save();
  calculate();
}

function rowSlotCount(row) {
  const wellCount = (row.wells || []).filter(Boolean).length;
  return wellCount || Math.max(1, row.cts?.length || replicateCount);
}

function parseCtColumn(text) {
  const lines = String(text ?? '').replaceAll('\ufeff', '').replaceAll('\r', '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  const values = [];
  let skipped = 0;
  let numeric = 0;
  const headerPattern = /^(ct|cq|cp|ct\s*value|cq\s*value|crossing\s*point|crossingpoint|cycle|value|ct值|cq值|cp值|结果)$/i;
  const missingPattern = /^(undetermined|undefined|no\s*cq|no\s*ct|no\s*cp|n\/a|na|nan|null|failed|invalid|—|–|-)$/i;

  lines.forEach(rawLine => {
    const cell = rawLine.split('\t')[0].trim().replace(/^"|"$/g, '');
    if (!cell) {
      values.push('');
      return;
    }
    if (headerPattern.test(cell)) {
      skipped += 1;
      return;
    }
    if (missingPattern.test(cell)) {
      values.push('');
      return;
    }

    const normalized = cell.replace(/，/g, ',').replace(',', '.');
    const exact = normalized.match(/^-?\d+(?:\.\d+)?$/);
    if (exact) {
      values.push(Number(exact[0]));
      numeric += 1;
      return;
    }

    if (/^[A-P]\d{1,2}$/i.test(normalized)) {
      skipped += 1;
      return;
    }
    const tokens = normalized.match(/-?\d+(?:\.\d+)?/g) || [];
    const candidate = tokens.length ? Number(tokens[tokens.length - 1]) : NaN;
    const hasDecimal = tokens.some(token => token.includes('.'));
    const hasCtContext = /(ct|cq|cp|crossing)/i.test(normalized);
    const hasLetters = /[a-z]/i.test(normalized);
    if (Number.isFinite(candidate) && candidate >= 0 && candidate <= 60 && (!hasLetters || hasDecimal || hasCtContext || tokens.length > 1)) {
      values.push(candidate);
      numeric += 1;
      return;
    }
    skipped += 1;
  });

  return { values, numeric, skipped };
}

function setCtPasteStatus(message, kind = '') {
  els.ctPasteStatus.textContent = message;
  els.ctPasteStatus.className = `paste-status ${kind ? `paste-status-${kind}` : ''}`;
}

function applyCtColumnText(text) {
  if (els.body.querySelector('tr[data-index]')) readRows();
  const parsed = parseCtColumn(text);
  if (!parsed.values.length || !parsed.numeric) {
    setCtPasteStatus('没有识别到 Ct 数值，请检查剪贴板内容。', 'warning');
    els.ctColumnPanel.classList.remove('hidden');
    return false;
  }

  const totalSlots = rows.reduce((sum, row) => sum + rowSlotCount(row), 0);
  if (!totalSlots) {
    setCtPasteStatus('当前数据表没有可填入的位置，请先应用点板模板。', 'warning');
    els.ctColumnPanel.classList.remove('hidden');
    return false;
  }

  let cursor = 0;
  rows = rows.map(row => {
    const count = rowSlotCount(row);
    const cts = Array(count).fill('');
    for (let index = 0; index < count && cursor < parsed.values.length; index += 1) {
      cts[index] = parsed.values[cursor];
      cursor += 1;
    }
    return { ...row, cts };
  });

  renderRows();
  calculate();
  save();

  const used = Math.min(parsed.values.length, totalSlots);
  const extra = Math.max(0, parsed.values.length - totalSlots);
  const missing = Math.max(0, totalSlots - parsed.values.length);
  let message = `已按点板顺序填入 ${used} / ${totalSlots} 个位置。`;
  if (missing) message += ` 后面 ${missing} 个位置保持空白。`;
  if (extra) message += ` 多出的 ${extra} 个值未使用。`;
  if (parsed.skipped) message += ` 已忽略 ${parsed.skipped} 行标题或非 Ct 内容。`;
  setCtPasteStatus(message, missing || extra ? 'warning' : 'success');
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
  } catch (error) {
    setCtPasteStatus('浏览器未允许读取剪贴板，请在上方粘贴一竖列 Ct 后点击“填入当前数据表”。', 'warning');
    els.ctColumnArea.focus();
  }
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function fmt(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '') : '—';
}

function stats(row) {
  const values = row.cts.map(Number).filter(value => Number.isFinite(value) && value > 0);
  const avg = values.length ? mean(values) : null;
  return {
    mean: avg,
    sd: values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)) : 0,
    spread: values.length > 1 ? Math.max(...values) - Math.min(...values) : 0,
    n: values.length
  };
}

function calculate() {
  const ref = els.ref.value.trim().toLowerCase();
  const control = els.control.value.trim().toLowerCase();
  const maxSpread = Number(els.spread.value) || 0.5;

  // Merge duplicate sample+group+gene records (re-plated wells, split
  // imports): concatenate their replicates instead of treating the extra
  // rows as independent samples or silently dropping them.
  const enriched = rows.map(row => ({ ...row, s: stats(row) }));
  const mergedByKey = new Map();
  const mergedLabels = new Set();
  enriched.forEach(row => {
    const key = `${row.name}|||${row.group}|||${row.gene.trim().toLowerCase()}`;
    if (!mergedByKey.has(key)) {
      mergedByKey.set(key, { ...row, cts: [...row.cts] });
    } else {
      const existing = mergedByKey.get(key);
      existing.cts = existing.cts.concat(row.cts);
      existing.s = stats(existing);
      mergedLabels.add(`${row.name} · ${row.gene}`);
    }
  });

  const bySample = {};
  [...mergedByKey.values()].forEach(row => {
    const key = `${row.name}|||${row.group}`;
    (bySample[key] ||= []).push(row);
  });

  let output = [];
  const singleRepLabels = new Set();
  Object.values(bySample).forEach(items => {
    const reference = items.find(item => item.gene.trim().toLowerCase() === ref);
    items.filter(item => item.gene.trim().toLowerCase() !== ref).forEach(target => {
      if (!reference || !Number.isFinite(reference.s.mean) || !Number.isFinite(target.s.mean)) return;
      // Single-replicate records still produce a point estimate, but have no
      // replicate support: no error bar and flagged as 单孔.
      const paired = target.s.n >= 2 && reference.s.n >= 2;
      if (!paired) singleRepLabels.add(`${target.name} · ${target.gene}`);
      output.push({
        name: target.name,
        group: target.group,
        gene: target.gene,
        target: target.s.mean,
        reference: reference.s.mean,
        dct: target.s.mean - reference.s.mean,
        // Target and reference replicates live in independent wells: there is
        // no real pairing, so ΔCt SEM propagates both SDs independently:
        // SE = sqrt(tSd²/tN + rSd²/rN). Never pair by array index.
        se: paired
          ? Math.sqrt(
            (target.s.sd ** 2) / target.s.n +
            (reference.s.sd ** 2) / reference.s.n
          )
          : null,
        targetSpread: target.s.spread,
        referenceSpread: reference.s.spread,
        n: Math.min(target.s.n, reference.s.n)
      });
    });
  });
  latestNotes = { merged: [...mergedLabels], singleRep: [...singleRepLabels] };

  // Control ΔCt statistics are computed per target gene, never mixed across
  // genes. Gene/group comparisons use trimmed lowercase names.
  const controlByGene = new Map();
  output.forEach(item => {
    if (item.group.trim().toLowerCase() !== control) return;
    const key = item.gene.trim().toLowerCase();
    if (!controlByGene.has(key)) controlByGene.set(key, []);
    controlByGene.get(key).push(item);
  });
  const controlStatsByGene = new Map();
  controlByGene.forEach((items, key) => {
    const dcts = items.map(item => item.dct);
    const avg = mean(dcts);
    // With several independent control samples, the control mean SE is
    // sd(dcts)/sqrt(n); with a single control sample, use its own SEM.
    let se;
    if (items.length > 1) {
      const variance = dcts.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (dcts.length - 1);
      se = Math.sqrt(variance / dcts.length);
    } else {
      se = items[0].se;
    }
    controlStatsByGene.set(key, { gene: items[0].gene, mean: avg, se, n: items.length });
  });

  output = output.map(item => {
    const qc = Math.max(item.targetSpread, item.referenceSpread) <= maxSpread && item.n >= 2;
    if (els.mode.value !== 'ddct') {
      const fold = Math.pow(2, -item.dct);
      return {
        ...item,
        qc,
        ddct: null,
        controlMean: null,
        controlN: null,
        error: item.se,
        fold,
        foldLow: Number.isFinite(item.se) ? Math.pow(2, -(item.dct + item.se)) : fold,
        foldHigh: Number.isFinite(item.se) ? Math.pow(2, -(item.dct - item.se)) : fold
      };
    }
    const controlStats = controlStatsByGene.get(item.gene.trim().toLowerCase());
    if (!controlStats || !Number.isFinite(controlStats.mean)) {
      // No silent fallback to 2^-ΔCt: this gene has no control data.
      return {
        ...item,
        qc,
        missingControl: true,
        ddct: null,
        controlMean: null,
        controlN: null,
        error: null,
        fold: null,
        foldLow: null,
        foldHigh: null
      };
    }
    const ddct = item.dct - controlStats.mean;
    // Error bars show only the sample's own technical SEM. When several
    // control samples exist, controlStats.se measures BETWEEN-SAMPLE
    // (biological) variation — a different statistical layer that must not
    // be merged into a technical error bar; it is reported in the summary
    // instead. The control mean's uncertainty is therefore not included in
    // the bars, and they are not the full SE of the ΔΔCt estimator.
    const isControl = item.group.trim().toLowerCase() === control;
    const error = isControl ? null : item.se;
    const fold = Math.pow(2, -ddct);
    return {
      ...item,
      qc,
      ddct,
      controlMean: controlStats.mean,
      controlN: controlStats.n,
      error,
      fold,
      foldLow: Number.isFinite(error) ? Math.pow(2, -(ddct + error)) : fold,
      foldHigh: Number.isFinite(error) ? Math.pow(2, -(ddct - error)) : fold
    };
  });

  latest = output;
  renderResults(controlStatsByGene);
  save();
}

function renderResults(controlStatsByGene) {
  const maxSpread = Number(els.spread.value) || 0.5;
  els.desc.textContent = els.mode.value === 'ddct'
    ? '以对照组为校准样本，按目标基因分别计算 ΔCt、ΔΔCt 和相对表达倍数。'
    : '仅以内参基因归一化，计算每个样本的 ΔCt 和 2^-ΔCt。';
  els.formula.innerHTML = els.mode.value === 'ddct'
    ? '<strong>相对表达：</strong>ΔCt = Ct(目标基因) − Ct(内参基因)；ΔΔCt = ΔCt(样本) − 对照组同基因平均 ΔCt；相对表达量 = 2<sup>−ΔΔCt</sup>。误差棒仅为该样本技术重复的 SEM（ΔCt 层面），不含对照组均值不确定性，也不代表组间生物学重复统计；对照组有多个生物学样本时，其样本间变异在摘要中单独给出；对照组样本作为基准不画误差棒。'
    : '<strong>归一化表达：</strong>ΔCt = Ct(目标基因) − Ct(内参基因)；归一化表达量 = 2<sup>−ΔCt</sup>。误差棒为 ΔCt 的 SEM，仅反映技术重复层面。';

  const summaryItems = [
    ['有效结果', latest.length],
    ['目标基因', new Set(latest.map(item => item.gene)).size]
  ];
  if (els.mode.value === 'ddct') {
    controlStatsByGene.forEach(stats => {
      const value = stats.n > 1
        ? `${fmt(stats.mean)} ± ${fmt(stats.se)}（n=${stats.n}，样本间 SEM）`
        : `${fmt(stats.mean)}（n=${stats.n}）`;
      summaryItems.push([`${stats.gene} 对照组平均 ΔCt`, value]);
    });
  }
  summaryItems.push(['需复核', latest.filter(item => !item.qc || item.missingControl).length]);
  els.summary.innerHTML = summaryItems
    .map(item => `<div class="summary-item"><span class="summary-label">${escapeHtml(item[0])}</span><span class="summary-value">${item[1]}</span></div>`).join('');

  const messages = [];
  if (!latest.length) {
    messages.push(['warning', '请录入成对的目标基因与内参基因 Ct 数据。']);
  }
  if (latestNotes.merged.length) {
    messages.push(['warning', `检测到重复的“样本 + 组别 + 基因”记录，已合并其技术重复：${latestNotes.merged.map(escapeHtml).join('、')}`]);
  }
  if (latestNotes.singleRep.length) {
    messages.push(['warning', `仅 1 个有效孔，无技术重复误差，结果请谨慎使用：${latestNotes.singleRep.map(escapeHtml).join('、')}`]);
  }
  const missingGenes = [...new Set(latest.filter(item => item.missingControl).map(item => item.gene))];
  if (missingGenes.length) {
    messages.push(['danger', `无法计算 ${missingGenes.map(escapeHtml).join('、')} 的 ΔΔCt：对照组中没有对应基因的有效数据。`]);
  }
  const controlQcIssues = [...new Set(latest.filter(item => !item.missingControl && !item.qc && item.group.trim().toLowerCase() === els.control.value.trim().toLowerCase()).map(item => `${item.name} · ${item.gene}`))];
  if (controlQcIssues.length) {
    messages.push(['danger', `对照组存在需复核记录，会影响所有样本的 ΔΔCt，请优先复核：${controlQcIssues.map(escapeHtml).join('、')}`]);
  }
  const referenceRoles = [...new Set(blocks.filter(block => block.role === 'reference').map(block => block.gene.trim().toLowerCase()))];
  if (referenceRoles.length > 1) {
    messages.push(['danger', '模板中包含多个不同的内参基因，请统一为一个内参后再分析。']);
  } else if (referenceRoles.length === 1 && referenceRoles[0] !== els.ref.value.trim().toLowerCase()) {
    messages.push(['warning', `模板内参与当前内参基因（${escapeHtml(els.ref.value)}）不一致，正式计算以内参基因输入框为准。`]);
  }
  const targetIssues = [...new Set(latest.filter(item => !item.missingControl && item.targetSpread > maxSpread).map(item => `${item.name} · ${item.gene}`))];
  if (targetIssues.length) {
    messages.push(['warning', `目标基因技术重复 Ct 极差过大：${targetIssues.map(escapeHtml).join('、')}`]);
  }
  const referenceIssues = [...new Set(latest.filter(item => !item.missingControl && item.referenceSpread > maxSpread).map(item => `${item.name} · ${item.gene}`))];
  if (referenceIssues.length) {
    messages.push(['warning', `内参基因技术重复 Ct 极差过大：${referenceIssues.map(escapeHtml).join('、')}`]);
  }
  if (!messages.length) {
    messages.push(['success', '当前有效结果通过基础技术重复检查。']);
  }
  els.alerts.innerHTML = messages.map(([type, text]) => `<div class="alert alert-${type}">${text}</div>`).join('');

  els.chart.innerHTML = resultsChartSvg();

  els.results.innerHTML = latest.map(item => `<tr>
    <td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.group)}</td><td>${escapeHtml(item.gene)}</td>
    <td>${fmt(item.target)}</td><td>${fmt(item.reference)}</td><td>${fmt(item.dct)}</td>
    <td>${els.mode.value === 'ddct' ? fmt(item.ddct) : '—'}</td><td>${fmt(item.fold)}</td>
    <td><span class="status ${item.missingControl || !item.qc ? 'status-warning' : 'status-ok'}">${item.missingControl ? '缺对照' : item.n < 2 ? '单孔' : item.qc ? '通过' : '需复核'}</span></td>
  </tr>`).join('') || '<tr><td colspan="9" style="text-align:center;color:#64748b;padding:24px">暂无可计算结果</td></tr>';
}

function resultsChartSvg() {
  const items = latest.filter(item => Number.isFinite(item.fold));
  if (!items.length) return '';
  const width = Math.max(240, items.length * 76 + 16);
  const height = 210;
  const baseY = height - 34;
  const top = 14;
  const maxValue = Math.max(...items.map(item => (Number.isFinite(item.foldHigh) ? item.foldHigh : item.fold))) || 1;
  const scale = value => (baseY - top) * (value / maxValue);
  const bars = items.map((item, index) => {
    const x = 8 + index * 76;
    const cx = x + 23;
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
    return `<rect x="${x}" y="${y}" width="46" height="${Math.max(1, baseY - y)}" rx="4" fill="${color}"/>`
      + error
      + `<text x="${cx}" y="${Math.max(10, yHigh - 5)}" text-anchor="middle" font-size="10" fill="#334155">${fmt(item.fold)}</text>`
      + `<text x="${cx}" y="${baseY + 14}" text-anchor="middle" font-size="9.5" fill="#64748b">${escapeHtml(item.name)}</text>`
      + `<text x="${cx}" y="${baseY + 26}" text-anchor="middle" font-size="9.5" fill="#94a3b8">${escapeHtml(item.gene)}</text>`;
  }).join('');
  const axis = `<line x1="4" y1="${baseY}" x2="${width - 4}" y2="${baseY}" stroke="#cbd5e1" stroke-width="1"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" style="width:${width}px;max-width:none" role="img" aria-label="相对表达量柱状图（含误差棒）">${axis}${bars}</svg>`;
}

function resultsCsv() {
  return [
    '样本,组别,目标基因,目标Ct,内参Ct,DeltaCt,对照组平均DeltaCt,对照组N,DeltaDeltaCt,相对表达量,误差类型,误差值,Fold下限,Fold上限,质控',
    ...latest.map(item => [
      item.name, item.group, item.gene, fmt(item.target), fmt(item.reference), fmt(item.dct),
      fmt(item.controlMean), item.controlN ?? '', fmt(item.ddct), fmt(item.fold),
      Number.isFinite(item.error) ? 'SEM' : '—', fmt(item.error), fmt(item.foldLow), fmt(item.foldHigh),
      item.missingControl ? '缺对照' : item.n < 2 ? '单孔' : item.qc ? '通过' : '需复核'
    ].map(csvCell).join(','))
  ].join('\n');
}

function plateCsv() {
  return [
    '孔板规格,孔位,样本,组别,基因,类型,技术重复序号',
    ...latestPlate.placements.map(item => [currentPlate().size, item.well, item.sample, item.group, item.gene, item.role === 'reference' ? '内参' : '目标', item.rep].map(csvCell).join(','))
  ].join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(filename, content) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function loadPreset() {
  blocks = buildTemplate(targetCount());
  els.startRow.value = currentPlate().rows[0];
  els.startCol.value = '1';
  els.direction.value = 'horizontal';
  els.gap.value = '0';
  renderBlocks();
  renderPlate();
  save();
}

function exportTemplate() {
  readBlocks();
  const payload = { app: 'qpcr-tools', kind: 'plate-template', version: 2, replicateCount, blocks };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
  link.download = 'qpcr-plate-template.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function importTemplate(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const list = Array.isArray(data) ? data : data?.blocks;
      if (!Array.isArray(list) || !list.length) throw new Error('invalid template');
      // Handle replicateCount: version 2 has it at top level, version 1 infers from block.reps
      if (data.version >= 2 && data.replicateCount !== undefined) {
        replicateCount = normalizeReplicateCount(data.replicateCount);
      } else if (list.some(b => b.reps !== undefined)) {
        const repsValues = [...new Set(list.map(b => Number(b.reps) || 3))];
        if (repsValues.length === 1 && repsValues[0] >= MIN_REPS && repsValues[0] <= MAX_REPS_GLOBAL) {
          replicateCount = repsValues[0];
        } else {
          replicateCount = DEFAULT_REPS;
          window.alert('导入的旧模板包含混合复孔设置，已使用默认值 3。请确认模板布局后再应用。');
        }
      }
      blocks = list.map(normalizeBlock);
      if (blocks[0]) blocks[0].breakBefore = false;
      renderBlocks();
      renderPlate();
      save();
    } catch {
      window.alert('无法导入：文件不是有效的点板模板 JSON。');
    }
  };
  reader.readAsText(file);
}

function parseFullTable(text) {
  const plate = currentPlate();
  return String(text).trim().split(/\n/)
    .map(line => line.replace(/\r$/, '').split(/\t|,/))
    .filter(parts => parts.length >= 4)
    .map(parts => {
      const first = parts[0].trim();
      const wells = first.split(/[,，;\s]+/).map(value => value.trim().toUpperCase()).filter(Boolean);
      const hasWellColumn = wells.length > 0 && wells.every(well => {
        const match = well.match(/^([A-P])(\d{1,2})$/);
        return match && plate.rows.includes(match[1]) && Number(match[2]) >= 1 && Number(match[2]) <= plate.cols;
      });
      const offset = hasWellColumn ? 1 : 0;
      if (parts.length < 4 + offset) return null;
      const cts = parts.slice(3 + offset).map(value => value.trim()).slice(0, replicateCount);
      return {
        wells: hasWellColumn ? wells : Array(Math.max(replicateCount, cts.length)).fill(''),
        name: parts[offset].trim(),
        group: parts[offset + 1].trim(),
        gene: parts[offset + 2].trim(),
        cts: cts.length ? cts : Array(replicateCount).fill('')
      };
    }).filter(Boolean);
}

$('#loadPresetBtn').addEventListener('click', loadPreset);
$('#exampleTemplateBtn').addEventListener('click', () => {
  blocks = exampleTemplate();
  els.startRow.value = currentPlate().rows[0];
  els.startCol.value = '1';
  els.direction.value = 'horizontal';
  els.gap.value = '0';
  renderBlocks();
  renderPlate();
  applyPlateToRows();
  fillExampleCts();
  renderRows();
  calculate();
});
els.targets.addEventListener('input', save);
els.targets.addEventListener('change', () => {
  targetCount();
  save();
});
$('#clearBlocksBtn').addEventListener('click', () => {
  blocks = [];
  renderBlocks();
  renderPlate();
  save();
});
$('#appendPresetBtn').addEventListener('click', appendPreset);
$('#addBlockBtn').addEventListener('click', () => {
  readBlocks();
  const block = blankBlock();
  block.sample = uniqueSampleName(block.sample);
  blocks.push(block);
  if (generatePlacements().overflow) {
    blocks.pop();
    window.alert(`${currentPlate().label}空间不足，无法继续添加区块。`);
  }
  renderBlocks();
  renderPlate();
  save();
});
$('#applyPlateBtn').addEventListener('click', applyPlateToRows);
$('#exportPlateBtn').addEventListener('click', () => downloadCsv(`qpcr-${currentPlate().size}-well-plate-plan.csv`, plateCsv()));
$('#exportTemplateBtn').addEventListener('click', exportTemplate);
$('#importTemplateBtn').addEventListener('click', () => $('#templateFileInput').click());
$('#templateFileInput').addEventListener('change', event => {
  const file = event.target.files[0];
  if (file) importTemplate(file);
  event.target.value = '';
});

els.plateSize.addEventListener('change', () => {
  refreshCoordinateSelects(els.startRow.value, els.startCol.value);
  renderPlate();
  save();
});
[els.startRow, els.startCol, els.direction, els.gap].forEach(control => control.addEventListener('change', () => {
  renderPlate();
  save();
}));

els.repsInput.addEventListener('change', () => {
  const oldCount = replicateCount;
  replicateCount = normalizeReplicateCount(els.repsInput.value);
  els.repsInput.value = String(replicateCount);
  if (oldCount === replicateCount) return;
  // Non-destructive resize rows
  if (rows.length) {
    const result = resizeReplicates(rows, oldCount, replicateCount);
    if (result === null) {
      replicateCount = oldCount;
      els.repsInput.value = String(oldCount);
      return;
    }
    rows = result;
  }
  // Sync block reps to global setting and re-validate
  blocks.forEach(b => { b.reps = replicateCount; });
  els.targets.max = String(maxTargetCount());
  targetCount();
  renderBlocks();
  renderPlate();
  renderRows();
  calculate();
  save();
});

$('#addSampleBtn').addEventListener('click', () => {
  readRows();
  rows.push(blankRow());
  renderRows();
  calculate();
});
$('#exampleDataBtn').addEventListener('click', () => {
  readRows();
  fillExampleCts();
  renderRows();
  calculate();
});
$('#clearDataBtn').addEventListener('click', () => {
  rows = [blankRow()];
  renderRows();
  calculate();
});
$('#resetBtn').addEventListener('click', () => {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_KEY);
  replicateCount = DEFAULT_REPS;
  els.repsInput.value = String(DEFAULT_REPS);
  els.targets.value = '1';
  els.appendCount.value = '1';
  els.appendNewLine.checked = false;
  els.plateSize.value = '96';
  refreshCoordinateSelects('A', '1');
  els.direction.value = 'horizontal';
  els.gap.value = '0';
  els.mode.value = 'ddct';
  els.ref.value = 'GAPDH';
  els.control.value = 'NC';
  els.spread.value = 0.5;
  blocks = buildTemplate(1);
  rows = clone(exampleRows);
  els.ctColumnArea.value = '';
  els.ctColumnPanel.classList.add('hidden');
  els.paste.classList.add('hidden');
  renderBlocks();
  renderPlate();
  renderRows();
  calculate();
});

$('#pasteColumnBtn').addEventListener('click', pasteCtColumnFromClipboard);
$('#applyCtColumnBtn').addEventListener('click', () => applyCtColumnText(els.ctColumnArea.value));
$('#closeCtColumnBtn').addEventListener('click', () => els.ctColumnPanel.classList.add('hidden'));
$('#pasteBtn').addEventListener('click', () => els.paste.classList.toggle('hidden'));
els.paste.addEventListener('input', () => {
  const parsed = parseFullTable(els.paste.value);
  if (parsed.length) {
    rows = parsed;
    renderRows();
    calculate();
  }
});

$('#copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultsCsv());
  } catch {
    window.alert('浏览器未允许复制，请使用“导出 CSV”。');
  }
});
$('#exportBtn').addEventListener('click', () => downloadCsv('qpcr-results.csv', resultsCsv()));
[els.mode, els.ref, els.control, els.spread].forEach(control => control.addEventListener('input', calculate));

refreshCoordinateSelects('A', '1');
load();
renderBlocks();
renderPlate();
renderRows();
calculate();
