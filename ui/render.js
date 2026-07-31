'use strict';

/**
 * DOM rendering functions for the qPCR analysis tool.
 * These functions are impure: they read/write innerHTML and attach event listeners.
 * But they take all state as arguments — no hidden global access.
 */

import { parseCt } from '../core/ct.js';
import { fmt } from './charts.js';
import { normalizeKey } from '../core/normalize.js';
import { resolveGeneName, resolveGroupName, resolveGroupId, resolveGeneId, getBaselineGroups } from '../state/experiment.js';

// ---- Utilities ----

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ---- Group chips ----

export function renderGroups(experiment, containers) {
  const { groupsContainer, bioRepsInput } = containers;
  const frag = document.createDocumentFragment();

  const isBaseline = g => !g.compareToGroupId || g.compareToGroupId === g.id;

  // Order groups: each baseline followed by its dependents, then orphans
  const baselines = experiment.groups.filter(g => isBaseline(g));
  const byBaseline = new Map();
  baselines.forEach(b => byBaseline.set(b.id, []));
  const orphans = [];
  experiment.groups.forEach(g => {
    if (isBaseline(g)) return;
    const cid = g.compareToGroupId;
    if (cid && byBaseline.has(cid)) byBaseline.get(cid).push(g);
    else orphans.push(g);
  });

  const orderedGroups = [];
  baselines.forEach(b => {
    orderedGroups.push(b);
    (byBaseline.get(b.id) || []).forEach(d => orderedGroups.push(d));
  });
  orphans.forEach(g => orderedGroups.push(g));

  let first = true;
  orderedGroups.forEach(g => {
    // Line break before each baseline (except the first)
    if (!first && isBaseline(g)) {
      const br = document.createElement('span');
      br.className = 'chip-line-break';
      br.setAttribute('aria-hidden', 'true');
      frag.appendChild(br);
    }
    first = false;

    const chip = document.createElement('span');
    chip.className = 'group-chip' + (isBaseline(g) ? ' chip-baseline' : '');
    chip.dataset.id = g.id;

    const nameEl = document.createElement('span');
    nameEl.className = 'chip-name';
    nameEl.textContent = g.name;
    chip.appendChild(nameEl);

    const editBtn = document.createElement('button');
    editBtn.className = 'chip-edit';
    editBtn.textContent = '改';
    editBtn.title = '修改分组名';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      const name = (window.prompt('修改分组名称：', g.name) || '').trim();
      if (name && name !== g.name) {
        containers.onRenameGroup(g.id, name);
      }
    });
    chip.appendChild(editBtn);

    // Comparison group select
    if (experiment.groups.length > 1) {
      const sel = document.createElement('select');
      sel.className = 'chip-compare';
      const optBaseline = document.createElement('option');
      optBaseline.value = '';
      optBaseline.textContent = '作为基准';
      sel.appendChild(optBaseline);
      experiment.groups.forEach(other => {
        if (other.id === g.id) return;
        if (!isBaseline(other)) return;
        const opt = document.createElement('option');
        opt.value = other.id;
        opt.textContent = other.name;
        sel.appendChild(opt);
      });
      sel.value = g.compareToGroupId || '';
      sel.title = '选择比较基准组';
      sel.addEventListener('change', e => {
        e.stopPropagation();
        const val = e.target.value || null;
        containers.onSetCompareToGroup(g.id, val);
      });
      sel.addEventListener('click', e => e.stopPropagation());
      chip.appendChild(sel);
    }

    if (isBaseline(g)) {
      const badge = document.createElement('span');
      badge.className = 'chip-badge';
      badge.textContent = '基准';
      chip.appendChild(badge);
    }

    if (experiment.groups.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.className = 'chip-del';
      delBtn.innerHTML = '&times;';
      delBtn.title = '删除分组';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        containers.onRemoveGroup(g.id);
      });
      chip.appendChild(delBtn);
    }

    frag.appendChild(chip);
  });

  groupsContainer.replaceChildren(frag);
  if (bioRepsInput) bioRepsInput.value = String(experiment.biologicalReplicates);
}

// ---- Target gene chips ----

export function renderTargetGenes(experiment, maxCount, containers) {
  const { targetGenesContainer, addTargetGeneBtn } = containers;
  const frag = document.createDocumentFragment();

  experiment.targetGenes.forEach((g, i) => {
    const chip = document.createElement('span');
    chip.className = 'group-chip';
    chip.dataset.id = g.id;

    const nameEl = document.createElement('span');
    nameEl.className = 'chip-name';
    nameEl.textContent = g.name;
    chip.appendChild(nameEl);

    const editBtn = document.createElement('button');
    editBtn.className = 'chip-edit';
    editBtn.textContent = '改';
    editBtn.title = '修改基因名';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      const name = (window.prompt('修改基因名：', g.name) || '').trim();
      if (name && name !== g.name) {
        containers.onRenameTargetGene(g.id, name);
      }
    });
    chip.appendChild(editBtn);

    if (experiment.targetGenes.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.className = 'chip-del';
      delBtn.innerHTML = '&times;';
      delBtn.title = '删除目标基因';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        containers.onRemoveTargetGene(g.id);
      });
      chip.appendChild(delBtn);
    }

    frag.appendChild(chip);
  });

  targetGenesContainer.replaceChildren(frag);

  if (addTargetGeneBtn) {
    addTargetGeneBtn.disabled = experiment.targetGenes.length >= maxCount;
    addTargetGeneBtn.title = experiment.targetGenes.length >= maxCount
      ? `当前孔板最多支持 ${maxCount} 个目标基因`
      : '添加目标基因';
  }
}

// ---- Reference gene chip ----

export function renderRefGene(experiment, containers) {
  const { refGeneContainer } = containers;
  const refGene = experiment.refGene || { id: 'ref', name: 'GAPDH' };
  const frag = document.createDocumentFragment();

  const chip = document.createElement('span');
  chip.className = 'group-chip ref-chip';

  const nameEl = document.createElement('span');
  nameEl.className = 'chip-name';
  nameEl.textContent = refGene.name;
  chip.appendChild(nameEl);

  const editBtn = document.createElement('button');
  editBtn.className = 'chip-edit';
  editBtn.textContent = '改';
  editBtn.title = '修改内参基因名';
  editBtn.addEventListener('click', e => {
    e.stopPropagation();
    const name = (window.prompt('修改内参基因名：', refGene.name) || '').trim();
    if (name && name !== refGene.name) {
      containers.onRenameRefGene(name);
    }
  });
  chip.appendChild(editBtn);

  const badge = document.createElement('span');
  badge.className = 'chip-badge';
  badge.textContent = '内参';
  chip.appendChild(badge);

  frag.appendChild(chip);
  refGeneContainer.replaceChildren(frag);
}

// ---- Blocks table ----

export function renderBlocks(blocks, experiment, container, callbacks) {
  if (!blocks.length) {
    container.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:22px">当前是空模板，请将预设载入孔板或添加点板区块。</td></tr>';
    return;
  }

  container.innerHTML = blocks.map((block, index) => `
    <tr data-index="${index}" data-group-id="${escapeHtml(block.groupId || '')}" data-gene-id="${escapeHtml(block.geneId || '')}">
      <td><input class="break-toggle" data-field="breakBefore" type="checkbox" ${block.breakBefore ? 'checked' : ''} ${index === 0 ? 'disabled' : ''} title="从新的一行开始" /></td>
      <td><input data-field="sample" value="${escapeHtml(block.sample)}" /></td>
      <td><input data-field="group" value="${escapeHtml(block.group || '')}" /></td>
      <td><input data-field="gene" value="${escapeHtml(block.gene || '')}" /></td>
      <td><span class="role-text">${block.role === 'reference' ? '内参' : '目标'}</span></td>
      <td class="action-col"><div class="block-actions">
        <button class="icon-button move-up" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-button move-down" title="下移" ${index === blocks.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-button danger remove-block" title="删除">×</button>
      </div></td>
    </tr>`).join('');

  container.querySelectorAll('input,select').forEach(el => {
    el.addEventListener('input', callbacks.onReadBlocks);
    el.addEventListener('change', callbacks.onReadBlocks);
  });
  container.querySelectorAll('.move-up').forEach(btn => btn.addEventListener('click', callbacks.onMoveBlock));
  container.querySelectorAll('.move-down').forEach(btn => btn.addEventListener('click', callbacks.onMoveBlock));
  container.querySelectorAll('.remove-block').forEach(btn => btn.addEventListener('click', callbacks.onRemoveBlock));
}

/**
 * Read blocks from DOM. Preserves existing IDs when the name matches,
 * resolves new IDs from experiment when the name changes.
 */
export function readBlocksFromDom(container, existingBlocks, experiment, replicateCount) {
  return [...container.querySelectorAll('tr[data-index]')].map(row => {
    const index = Number(row.dataset.index);
    const oldBlock = existingBlocks[index] || {};

    const groupName = row.querySelector('[data-field="group"]').value.trim();
    const geneName = row.querySelector('[data-field="gene"]').value.trim();

    // Preserve existing ID if name unchanged, otherwise resolve
    const oldGroupName = oldBlock.group || '';
    let groupId = oldBlock.groupId;
    if (normalizeKey(groupName) !== normalizeKey(oldGroupName) || !groupId) {
      const resolved = resolveGroupId(experiment, groupName);
      groupId = resolved.id;
    }

    const oldGeneName = oldBlock.gene || '';
    let geneId = oldBlock.geneId;
    if (normalizeKey(geneName) !== normalizeKey(oldGeneName) || !geneId) {
      const resolved = resolveGeneId(experiment, geneName);
      geneId = resolved.id;
    }

    return {
      breakBefore: row.querySelector('[data-field="breakBefore"]').checked,
      sample: row.querySelector('[data-field="sample"]').value.trim(),
      group: groupName,
      groupId,
      gene: geneName,
      geneId,
      role: oldBlock.role || 'target',
      reps: replicateCount
    };
  });
}

// ---- Plate grid ----

export function renderPlateGrid(plate, placements, experiment, gridEl, alertEl, legendEl, callbacks) {
  const groups = [...new Set(placements.map(item => item.group))];
  const groupClass = group => `group-${Math.max(0, groups.indexOf(group)) % 6}`;

  gridEl.className = `plate-grid plate-${plate.size}`;
  gridEl.style.setProperty('--plate-cols', String(plate.cols));
  gridEl.style.setProperty('--plate-rows', String(plate.rows.length));

  // Segment placements into contiguous runs for grouping
  const segments = plateSegments(placements);
  const segmentStart = new Map(segments.map(s => [`${s.row},${s.col}`, s]));
  const covered = new Set();
  segments.forEach(s => s.items.slice(1).forEach(item => covered.add(`${item.row},${item.col}`)));

  // Compare groups share a cluster ID (for example N1 + T1). Keep those
  // groups together and draw separators only between different clusters.
  const cellGroups = new Map(placements.map(item => [
    `${item.row},${item.col}`,
    item.clusterId || item.groupId || item.group || ''
  ]));
  /*
  segments.forEach(s => {
    const r = s.row;
    if (!rowCells.has(r)) rowCells.set(r, []);
    rowCells.get(r).push({ col: s.col, end: s.col + s.span - 1, cluster: s.items[0].clusterId });
  });
  rowCells.forEach(cells => cells.sort((a, b) => a.col - b.col));

  // Collect all cluster transition points: (row, col, prevCluster, newCluster)
  const transitions = [];
  let prev = null;
  segments.forEach(s => {
    const cur = { row: s.row, col: s.col, cluster: s.items[0].clusterId };
    if (prev && cur.cluster !== prev.cluster) {
      transitions.push({ row: cur.row, col: cur.col, from: prev.cluster, to: cur.cluster });
    }
    prev = cur;
  });

  // Row separation: find rows where cluster differs
  const rowBreaks = new Set();
  let lastClusters = null;
  for (let r = 0; r < plate.rows.length; r++) {
    const cells = rowCells.get(r);
    if (!cells) { lastClusters = null; continue; }
    const clusters = new Set(cells.map(c => c.cluster));
    if (lastClusters && ([...clusters].some(c => !lastClusters.has(c)) || [...lastClusters].some(c => !clusters.has(c)))) {
      rowBreaks.add(r);
    }
    lastClusters = clusters;
  }

  // Column separation: same-row cluster boundaries
  const colSplits = new Set();
  rowCells.forEach((cells, r) => {
    for (let i = 0; i < cells.length - 1; i++) {
      if (cells[i].cluster !== cells[i + 1].cluster) {
        colSplits.add(`${r},${cells[i + 1].col}`);
      }
    }
  });

  const sepRows = [...rowBreaks].sort((a, b) => a - b);
  const rowShift = r => r + 2 + sepRows.filter(sr => sr <= r).length;
  gridEl.style.setProperty('--plate-rows', String(plate.rows.length + sepRows.length)); */

  const wellHtml = item => {
    const displayGroup = item.group || resolveGroupName(experiment, item.groupId) || '';
    const displayGene = item.gene || resolveGeneName(experiment, item.geneId) || '';
    return `<div class="plate-well ${groupClass(displayGroup)} ${item.role === 'reference' ? 'reference' : ''}" title="${escapeHtml(item.sample)} · ${escapeHtml(displayGroup)} · ${escapeHtml(displayGene)} · 重复 ${item.rep}">
      <span class="well-id">${item.well}</span>
      <span class="well-role">${item.role === 'reference' ? '内参' : `R${item.rep}`}</span>
      <span class="well-sample">${escapeHtml(item.sample)}</span>
      <span class="well-gene">${escapeHtml(displayGene)}</span>
    </div>`;
  };

  let html = '<div class="plate-corner" style="grid-row:1;grid-column:1"></div>';
  html += Array.from({ length: plate.cols }, (_, i) => i + 1)
    .map(col => `<div class="plate-col-label" style="grid-row:1;grid-column:${col + 1}">${col}</div>`).join('');

  plate.rows.forEach((row, rowIndex) => {
    const gr = rowIndex + 2;

    html += `<div class="plate-row-label" style="grid-row:${gr};grid-column:1">${row}</div>`;
    for (let colIndex = 0; colIndex < plate.cols; colIndex += 1) {
      const key = `${rowIndex},${colIndex}`;
      const segment = segmentStart.get(key);
      if (segment) {
        const placement = segment.axis === 'v'
          ? `grid-row:${gr} / span ${segment.span};grid-column:${colIndex + 2}`
          : `grid-row:${gr};grid-column:${colIndex + 2} / span ${segment.span}`;
        const cls = [
          segment.axis === 'v' ? 'vertical' : '',
        ].filter(Boolean).join(' ');
        html += `<div class="well-group${cls ? ' ' + cls : ''}" style="${placement}">${segment.items.map(wellHtml).join('')}</div>`;
      } else if (!covered.has(key)) {
        const well = `${row}${colIndex + 1}`;
        html += `<button type="button" class="plate-well empty" data-well="${well}" style="grid-row:${gr};grid-column:${colIndex + 2}" title="点击将此孔设为模板起点"><span class="well-id">${well}</span></button>`;
      }
    }
  });

  // ---- SVG overlay for cluster boundary dashes ----
  const labelW = 28; // row label column width
  const headerH = 24; // column header height
  const gap = plate.size === '384' ? 8 : 10; // grid gap
  const ww = plate.size === '384' ? 50 : 68; // well width
  const wh = plate.size === '384' ? 44 : 56; // well height
  // CSS grid gap applies between ALL tracks (label col + header row too)
  const originX = labelW + gap;
  const originY = headerH + gap;

  // For each transition, find the boundary segment endpoints
  const hLines = []; // {y, x1, x2}
  const vLines = []; // {x, y1, y2}

  /* transitions.forEach(t => {
    const x = originX + t.col * (ww + gap) - gap / 2;

    // Vertical line: from transition row down through all rows
    // where new cluster exists (even if old cluster also exists)
    let yTop = originY + t.row * (wh + gap) - gap / 2;
    let yBot = yTop;
    let lastNewRow = t.row;
    for (let rr = t.row; rr < plate.rows.length; rr++) {
      const cells = rowCells.get(rr) || [];
      if (cells.some(c => c.cluster === t.to)) {
        lastNewRow = rr;
      } else {
        break;
      }
    }
    yBot = originY + (lastNewRow + 1) * (wh + gap) - gap / 2;
    if (yBot > yTop) {
      vLines.push({ x, y1: yTop, y2: yBot });
    }

    // Top horizontal: at transition row, cols from transition to right edge
    // separating shared row from row above
    if (t.row > 0) {
      const y = originY + t.row * (wh + gap) - gap / 2;
      const x1 = x;
      const x2 = originX + plate.cols * (ww + gap) - gap / 2;
      hLines.push({ y, x1, x2 });
    }

    // Bottom horizontal: at row where old cluster disappears, cols from left to transition
    for (let rr = t.row + 1; rr < plate.rows.length; rr++) {
      const cells = rowCells.get(rr) || [];
      const hasOld = cells.some(c => c.cluster === t.from);
      const hasNew = cells.some(c => c.cluster === t.to);
      if (!hasOld && hasNew) {
        const y = originY + rr * (wh + gap) - gap / 2;
        const x1 = originX;
        const x2 = x;
        hLines.push({ y, x1, x2 });
        break;
      }
    }
  }); */

  // Draw only boundaries between adjacent groups.
  for (let row = 0; row < plate.rows.length; row += 1) {
    for (let col = 0; col < plate.cols - 1; col += 1) {
      const left = cellGroups.get(`${row},${col}`);
      const right = cellGroups.get(`${row},${col + 1}`);
      if (left && right && left !== right) {
        vLines.push({
          x: originX + (col + 1) * (ww + gap) - gap / 2,
          y1: originY + row * (wh + gap),
          y2: originY + row * (wh + gap) + wh
        });
      }
    }
  }

  for (let row = 0; row < plate.rows.length - 1; row += 1) {
    let start = null;
    const flush = end => {
      if (start === null) return;
      hLines.push({
        y: originY + (row + 1) * (wh + gap) - gap / 2,
        x1: originX + start * (ww + gap),
        x2: originX + end * (ww + gap) + ww
      });
      start = null;
    };
    for (let col = 0; col < plate.cols; col += 1) {
      const upper = cellGroups.get(`${row},${col}`);
      const lower = cellGroups.get(`${row + 1},${col}`);
      const differs = upper && lower && upper !== lower;
      if (differs && start === null) start = col;
      if (!differs) flush(col - 1);
    }
    flush(plate.cols - 1);
  }

  // Build SVG — total size: label/header track + wells + (cols-1)/rows-1 gaps between them
  const svgW = originX + (plate.cols - 1) * (ww + gap) + ww;
  const svgH = originY + (plate.rows.length - 1) * (wh + gap) + wh;
  let svgLines = '';
  hLines.forEach(l => {
    svgLines += `<line x1="${l.x1}" y1="${l.y}" x2="${l.x2}" y2="${l.y}" stroke="var(--primary)" stroke-width="2" stroke-dasharray="6,4" />`;
  });
  vLines.forEach(l => {
    svgLines += `<line x1="${l.x}" y1="${l.y1}" x2="${l.x}" y2="${l.y2}" stroke="var(--primary)" stroke-width="2" stroke-dasharray="6,4" />`;
  });

  const svgOverlay = svgLines ? `<svg class="plate-sep-overlay" style="position:absolute;top:0;left:0;width:${svgW}px;height:${svgH}px;overflow:visible;pointer-events:none;z-index:1" xmlns="http://www.w3.org/2000/svg">${svgLines}</svg>` : '';

  gridEl.innerHTML = html + svgOverlay;

  gridEl.querySelectorAll('.plate-well.empty').forEach(btn => {
    btn.addEventListener('click', () => {
      if (callbacks && callbacks.onSetStartWell) callbacks.onSetStartWell(btn.dataset.well);
    });
  });

  legendEl.innerHTML = groups.map((group, i) =>
    `<span class="legend-item"><span class="legend-dot group-${i % 6}"></span>${escapeHtml(group)}</span>`
  ).join('') +
    (placements.length
      ? '<span class="legend-item"><span class="legend-line"></span>虚线边框 = 内参</span><span class="legend-item"><span class="legend-frame"></span>浅框 = 同一区块（一组技术重复）</span>'
      : '');
}

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
          current.axis = 'h'; current.span = 2; current.items.push(item); return;
        }
        if (item.col === current.col && item.row === current.row + 1) {
          current.axis = 'v'; current.span = 2; current.items.push(item); return;
        }
      } else if (current.axis === 'h' && item.row === current.row && item.col === current.col + current.span) {
        current.span += 1; current.items.push(item); return;
      } else if (current.axis === 'v' && item.col === current.col && item.row === current.row + current.span) {
        current.span += 1; current.items.push(item); return;
      }
    }
    flush();
    current = { blockIndex: item.blockIndex, axis: null, row: item.row, col: item.col, span: 1, items: [item] };
  });
  flush();
  return segments;
}

// ---- Ct data rows table ----

export function renderRows(rows, replicateCount, experiment, containerEl, headEl, callbacks) {
  const maxReps = Math.max(replicateCount, ...rows.map(row =>
    Math.max(row.cts?.length || 0, row.wells?.length || 0)
  ));

  headEl.innerHTML = `<tr><th>孔位</th><th>样本名称</th><th>组别</th><th>基因</th>${Array.from({ length: maxReps }, (_, i) => `<th>Ct ${i + 1}</th>`).join('')}<th class="action-col">操作</th></tr>`;

  containerEl.innerHTML = rows.map((row, index) => {
    const wells = Array.isArray(row.wells) ? row.wells : [];
    const cts = Array.isArray(row.cts) ? [...row.cts] : [];
    while (cts.length < maxReps) cts.push('');

    const wellsText = wells.filter(Boolean).join(', ');
    const ctInputs = cts.slice(0, maxReps).map((value, ctIndex) => {
      const parsed = parseCt(value);
      const valid = value === '' || value === null || value === undefined || parsed.valid;
      const cls = valid ? 'ct-input' : 'ct-input ct-invalid';
      const title = valid ? '' : 'Ct 值必须在 0–50 之间';
      return `<td><input class="${cls}" data-ct="${ctIndex}" type="number" step="0.01" min="0.01" max="50" value="${escapeHtml(value)}" title="${title}" /></td>`;
    }).join('');

    return `<tr data-index="${index}" data-group-id="${escapeHtml(row.groupId || '')}" data-gene-id="${escapeHtml(row.geneId || '')}">
      <td class="readonly-cell">${escapeHtml(wellsText) || '—'}</td>
      <td class="readonly-cell">${escapeHtml(row.name || '')}</td>
      <td class="readonly-cell">${escapeHtml(row.group || '')}</td>
      <td class="readonly-cell">${escapeHtml(row.gene || '')}</td>
      ${ctInputs}
      <td class="action-col"><button class="icon-button danger remove-row" title="删除">×</button></td>
    </tr>`;
  }).join('');

  containerEl.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', callbacks.onReadRows);
  });
  // Instant per-Ct-input validation feedback
  containerEl.querySelectorAll('.ct-input').forEach(input => {
    input.addEventListener('input', () => {
      const parsed = parseCt(input.value);
      const isEmpty = input.value.trim() === '';
      if (isEmpty || parsed.valid) {
        input.classList.remove('ct-invalid');
        input.title = '';
      } else {
        input.classList.add('ct-invalid');
        input.title = 'Ct 值必须在 0–50 之间';
      }
    });
  });
  containerEl.querySelectorAll('.remove-row').forEach(btn => {
    btn.addEventListener('click', event => {
      const index = Number(event.currentTarget.closest('tr').dataset.index);
      callbacks.onRemoveRow(index);
    });
  });
}

/**
 * Read rows from DOM. Wells, name, group, gene are driven by blocks
 * (read-only in the table), so we preserve them from the in-memory row.
 * Only Ct values are read from DOM inputs.
 */
export function readRowsFromDom(container, existingRows, experiment) {
  return [...container.querySelectorAll('tr[data-index]')].map(row => {
    const index = Number(row.dataset.index);
    const oldRow = existingRows[index] || {};

    return {
      wells: oldRow.wells || [],
      name: oldRow.name || '',
      group: oldRow.group || '',
      groupId: oldRow.groupId || '',
      gene: oldRow.gene || '',
      geneId: oldRow.geneId || '',
      cts: [...row.querySelectorAll('[data-ct]')].map(input => input.value)
    };
  });
}

// ---- Results ----

export function renderResults(results, mode, experiment, controlStatsByGene, containers) {
  const { desc, formula, summary, alerts, chart, groupChart, results: resultsBody } = containers;

  const refGeneName = experiment.refGene ? experiment.refGene.name : 'GAPDH';
  const baselineNames = (experiment.groups || []).filter(g => !g.compareToGroupId || g.compareToGroupId === g.id).map(g => g.name);
  const maxSpread = Number(containers.spreadEl ? containers.spreadEl.value : 0.5);

  // Description
  if (desc) {
    desc.innerHTML = mode === 'ddct'
      ? `内参基因：<strong>${escapeHtml(refGeneName)}</strong> · 基准组：<strong>${escapeHtml(baselineNames.join('、'))}</strong> — 各样本按所属组别指定的比较基准分别计算 ΔCt、ΔΔCt 和相对表达倍数。`
      : `内参基因：<strong>${escapeHtml(refGeneName)}</strong> — 仅以内参基因归一化，计算每个样本的 ΔCt 和 2^-ΔCt。`;
  }

  // Formula note
  if (containers.formula) {
    containers.formula.innerHTML = mode === 'ddct'
      ? '<strong>相对表达：</strong>ΔCt = Ct(目标基因) − Ct(内参基因)；ΔΔCt = ΔCt(样本) − 所属组别指定比较基准组的同基因平均 ΔCt；相对表达量 = 2<sup>−ΔΔCt</sup>。误差棒仅为该样本技术重复的 SEM（ΔCt 层面），基准组样本不画误差棒。'
      : '<strong>归一化表达：</strong>ΔCt = Ct(目标基因) − Ct(内参基因)；归一化表达量 = 2<sup>−ΔCt</sup>。误差棒为 ΔCt 的 SEM，仅反映技术重复层面。';
  }

  // Summary
  if (summary) {
    const items = [
      ['有效结果', results.length],
      ['目标基因', new Set(results.map(item => item.gene)).size],
      ['需复核', results.filter(item => !item.qc || item.missingControl).length]
    ];
    summary.innerHTML = items
      .map(item => `<div class="summary-item"><span class="summary-label">${escapeHtml(item[0])}</span><span class="summary-value">${item[1]}</span></div>`).join('');
  }

  // Alerts (gathered in caller, rendered here)
  if (alerts && containers.alertsHtml) {
    alerts.innerHTML = containers.alertsHtml;
  }

  // Charts — chartHTML and groupChartHTML are generated by the caller (avoids circular import)
  if (chart && containers.chartHTML !== undefined) {
    chart.innerHTML = containers.chartHTML;
  }

  if (groupChart && containers.groupChartHTML !== undefined) {
    groupChart.innerHTML = containers.groupChartHTML;
  }

  // Results table
  if (resultsBody) {
    resultsBody.innerHTML = results.map(item => `<tr>
      <td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.group)}</td><td>${escapeHtml(item.gene)}</td>
      <td>${mode === 'ddct' ? escapeHtml(item.compareToGroup || '—') : '—'}</td>
      <td>${fmt(item.targetCt)}</td><td>${fmt(item.referenceCt)}</td><td>${fmt(item.dct)}</td>
      <td>${mode === 'ddct' ? fmt(item.ddct) : '—'}</td><td>${fmt(item.fold)}</td>
      <td><span class="status ${item.missingControl || !item.qc ? 'status-warning' : 'status-ok'}">${item.missingControl ? '缺对照' : item.n < 2 ? '单孔' : item.qc ? '通过' : '需复核'}</span></td>
    </tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:#64748b;padding:24px">暂无可计算结果</td></tr>';
  }
}

/**
 * Build alerts HTML from analysis notes and QC results.
 * Returns HTML string that can be inserted into the alerts container.
 */
export function buildAlertsHtml(results, notes, experiment, maxSpread) {
  const refGeneName = experiment.refGene ? experiment.refGene.name : '';

  const messages = [];

  if (!results.length) {
    messages.push(['warning', '请录入成对的目标基因与内参基因 Ct 数据。']);
  }
  if (notes.merged && notes.merged.length) {
    messages.push(['warning', `检测到重复的"样本 + 组别 + 基因"记录，已合并其技术重复：${notes.merged.map(escapeHtml).join('、')}`]);
  }
  if (notes.singleRep && notes.singleRep.length) {
    messages.push(['warning', `仅 1 个有效孔，无技术重复误差，结果请谨慎使用：${notes.singleRep.map(escapeHtml).join('、')}`]);
  }

  // Missing control per gene — group by compareToGroup
  const missingByGroup = new Map();
  results.filter(item => item.missingControl).forEach(item => {
    const key = item.compareToGroup || '未知基准';
    if (!missingByGroup.has(key)) missingByGroup.set(key, new Set());
    missingByGroup.get(key).add(item.gene);
  });
  missingByGroup.forEach((genes, groupName) => {
    messages.push(['danger', `无法计算 ${[...genes].map(escapeHtml).join('、')} 的 ΔΔCt：比较基准"${escapeHtml(groupName)}"中没有对应基因的有效数据。`]);
  });

  // Baseline QC failures (per baseline group)
  const baselineIssues = new Map();
  results.filter(item => item.isBaseline && !item.qc && item.n >= 2).forEach(item => {
    const key = item.group || '未知';
    if (!baselineIssues.has(key)) baselineIssues.set(key, []);
    baselineIssues.get(key).push(`${item.name} · ${item.gene}`);
  });
  baselineIssues.forEach((items, groupName) => {
    messages.push(['danger', `基准组 ${escapeHtml(groupName)} 存在需复核记录，会影响以它为基准的样本的 ΔΔCt，请优先复核：${items.map(escapeHtml).join('、')}`]);
  });

  const targetIssues = [...new Set(
    results.filter(item => !item.missingControl && item.n >= 2 && item.targetSpread > maxSpread)
      .map(item => `${item.name} · ${item.gene}`)
  )];
  if (targetIssues.length) {
    messages.push(['warning', `目标基因技术重复 Ct 极差过大：${targetIssues.map(escapeHtml).join('、')}`]);
  }

  const referenceIssues = [...new Set(
    results.filter(item => !item.missingControl && item.n >= 2 && item.referenceSpread > maxSpread)
      .map(item => `${item.name} · ${item.gene}`)
  )];
  if (referenceIssues.length) {
    messages.push(['warning', `内参基因技术重复 Ct 极差过大：${referenceIssues.map(escapeHtml).join('、')}`]);
  }

  if (!messages.length) {
    messages.push(['success', '当前有效结果通过基础技术重复检查。']);
  }

  return messages.map(([type, text]) => `<div class="alert alert-${type}">${text}</div>`).join('');
}
