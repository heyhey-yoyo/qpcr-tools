'use strict';

/**
 * DOM rendering functions for the qPCR analysis tool.
 * These functions are impure: they read/write innerHTML and attach event listeners.
 * But they take all state as arguments — no hidden global access.
 */

import { parseCt } from '../core/ct.js';
import { fmt } from './charts.js';
import { normalizeKey } from '../core/normalize.js';
import { resolveGeneName, resolveGroupName, resolveGroupId, resolveGeneId, getControlGroup } from '../state/experiment.js';

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

  experiment.groups.forEach(g => {
    const chip = document.createElement('span');
    chip.className = 'group-chip' + (g.isControl ? ' chip-control' : '');
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

    if (g.isControl) {
      const badge = document.createElement('span');
      badge.className = 'chip-badge';
      badge.textContent = '对照';
      chip.appendChild(badge);
    } else {
      const ctlBtn = document.createElement('button');
      ctlBtn.className = 'chip-ctl';
      ctlBtn.textContent = '设为对照';
      ctlBtn.addEventListener('click', e => {
        e.stopPropagation();
        containers.onToggleControl(g.id);
      });
      chip.appendChild(ctlBtn);
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

  gridEl.innerHTML = html;

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
  const controlGroup = getControlGroup(experiment);
  const controlName = controlGroup ? controlGroup.name : 'NC';
  const maxSpread = Number(containers.spreadEl ? containers.spreadEl.value : 0.5);

  // Description
  if (desc) {
    desc.innerHTML = mode === 'ddct'
      ? `内参基因：<strong>${escapeHtml(refGeneName)}</strong> · 对照组：<strong>${escapeHtml(controlName)}</strong> — 以对照组为校准样本，按目标基因分别计算 ΔCt、ΔΔCt 和相对表达倍数。`
      : `内参基因：<strong>${escapeHtml(refGeneName)}</strong> — 仅以内参基因归一化，计算每个样本的 ΔCt 和 2^-ΔCt。`;
  }

  // Formula note
  if (containers.formula) {
    containers.formula.innerHTML = mode === 'ddct'
      ? '<strong>相对表达：</strong>ΔCt = Ct(目标基因) − Ct(内参基因)；ΔΔCt = ΔCt(样本) − 对照组同基因平均 ΔCt；相对表达量 = 2<sup>−ΔΔCt</sup>。误差棒仅为该样本技术重复的 SEM（ΔCt 层面），对照组样本作为基准不画误差棒。'
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
      <td>${fmt(item.targetCt)}</td><td>${fmt(item.referenceCt)}</td><td>${fmt(item.dct)}</td>
      <td>${mode === 'ddct' ? fmt(item.ddct) : '—'}</td><td>${fmt(item.fold)}</td>
      <td><span class="status ${item.missingControl || !item.qc ? 'status-warning' : 'status-ok'}">${item.missingControl ? '缺对照' : item.n < 2 ? '单孔' : item.qc ? '通过' : '需复核'}</span></td>
    </tr>`).join('') || '<tr><td colspan="9" style="text-align:center;color:#64748b;padding:24px">暂无可计算结果</td></tr>';
  }
}

/**
 * Build alerts HTML from analysis notes and QC results.
 * Returns HTML string that can be inserted into the alerts container.
 */
export function buildAlertsHtml(results, notes, experiment, maxSpread) {
  const controlGroup = getControlGroup(experiment);
  const controlName = controlGroup ? controlGroup.name : '';
  const controlNameKey = normalizeKey(controlName);
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

  const missingGenes = [...new Set(results.filter(item => item.missingControl).map(item => item.gene))];
  if (missingGenes.length) {
    messages.push(['danger', `无法计算 ${missingGenes.map(escapeHtml).join('、')} 的 ΔΔCt：对照组中没有对应基因的有效数据。`]);
  }

  // Only flag real QC failures (spread exceeds threshold), not single-replicate (n<2)
  const controlQcIssues = [...new Set(
    results.filter(item => !item.missingControl && !item.qc && item.n >= 2 && normalizeKey(item.group) === controlNameKey)
      .map(item => `${item.name} · ${item.gene}`)
  )];
  if (controlQcIssues.length) {
    messages.push(['danger', `对照组存在需复核记录，会影响所有样本的 ΔΔCt，请优先复核：${controlQcIssues.map(escapeHtml).join('、')}`]);
  }

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
