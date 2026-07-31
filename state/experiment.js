'use strict';

import { normalizeKey } from '../core/normalize.js';

let _idCounter = 0;
function uid(prefix) {
  _idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${_idCounter.toString(36)}`;
}

function fallbackNameId(prefix, name) {
  const key = normalizeKey(name);
  return key ? `${prefix}unknown:${encodeURIComponent(key)}` : uid(prefix);
}

// ---- Factories ----

export function createGroup(name, compareToGroupId) {
  return { id: uid('g'), name: String(name ?? '').trim(), compareToGroupId: compareToGroupId || null };
}

export function createTargetGene(name) {
  return { id: uid('tg'), name: String(name ?? '').trim() };
}

export function createExperiment(overrides) {
  const nc = { id: uid('g'), name: 'NC', compareToGroupId: null };
  const treatment = { id: uid('g'), name: 'Treatment', compareToGroupId: nc.id };
  return {
    groups: [nc, treatment],
    biologicalReplicates: 1,
    targetGenes: [{ id: uid('tg'), name: 'IL6' }],
    refGene: { id: 'ref', name: 'GAPDH' },
    ...overrides
  };
}

// ---- Queries ----

/** Groups whose compareToGroupId is null or self → they are calibration baselines. */
export function getBaselineGroups(experiment) {
  return (experiment && experiment.groups || []).filter(
    g => !g.compareToGroupId || g.compareToGroupId === g.id
  );
}

/** Normalise all group compareToGroupId assignments in the experiment.
 *  Guarantees at least one baseline; repairs dangling/self/invalid refs. */
export function ensureCompareAssignments(experiment) {
  if (!experiment || !experiment.groups || !experiment.groups.length) return experiment;
  const ids = new Set(experiment.groups.map(g => g.id));
  let hasBaseline = experiment.groups.some(g => !g.compareToGroupId || g.compareToGroupId === g.id);
  const firstId = experiment.groups[0].id;
  const groups = experiment.groups.map((g, i) => {
    let cid = g.compareToGroupId;
    if (!hasBaseline && i === 0) { cid = null; hasBaseline = true; }
    if (cid && cid !== g.id && !ids.has(cid)) cid = firstId === g.id ? null : firstId;
    if (cid === g.id) cid = null;
    if (!hasBaseline && !cid) hasBaseline = true;
    return { ...g, compareToGroupId: cid || null };
  });
  if (!groups.some(g => !g.compareToGroupId)) groups[0] = { ...groups[0], compareToGroupId: null };
  return { ...experiment, groups };
}

// ---- Resolvers ----

export function resolveGeneName(experiment, geneId) {
  if (!geneId || !experiment) return '';
  if (experiment.refGene && experiment.refGene.id === geneId) return experiment.refGene.name;
  const tg = (experiment.targetGenes || []).find(g => g.id === geneId);
  return tg ? tg.name : '';
}

export function resolveGroupName(experiment, groupId) {
  if (!groupId || !experiment) return '';
  const group = (experiment.groups || []).find(g => g.id === groupId);
  return group ? group.name : '';
}

export function resolveGeneId(experiment, name) {
  if (!experiment) return { id: fallbackNameId('tg', name), name: String(name ?? '').trim(), isRef: false };
  const key = normalizeKey(name);
  if (experiment.refGene && normalizeKey(experiment.refGene.name) === key) {
    return { id: experiment.refGene.id, name: experiment.refGene.name, isRef: true };
  }
  const tg = (experiment.targetGenes || []).find(g => normalizeKey(g.name) === key);
  return tg ? { id: tg.id, name: tg.name, isRef: false }
    : { id: fallbackNameId('tg', name), name: String(name ?? '').trim(), isRef: false };
}

export function resolveGroupId(experiment, name) {
  if (!experiment) return { id: fallbackNameId('g', name), name: String(name ?? '').trim() };
  const key = normalizeKey(name);
  const group = (experiment.groups || []).find(g => normalizeKey(g.name) === key);
  return group ? { id: group.id, name: group.name }
    : { id: fallbackNameId('g', name), name: String(name ?? '').trim() };
}

// ---- Mutations (return new experiment, do not mutate input) ----

function assertUniqueName(items, currentId, newName, label) {
  const key = normalizeKey(newName);
  if (items.some(item => item.id !== currentId && normalizeKey(item.name) === key)) {
    throw new Error(`${label}名称不能重复。`);
  }
}

export function addGroup(experiment, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return experiment;
  assertUniqueName(experiment.groups || [], null, trimmed, '分组');
  const firstBaseline = (experiment.groups || []).find(g => !g.compareToGroupId || g.compareToGroupId === g.id);
  const group = createGroup(trimmed, firstBaseline ? firstBaseline.id : null);
  return { ...experiment, groups: [...experiment.groups, group] };
}

export function renameGroup(experiment, groupId, newName) {
  const trimmed = String(newName ?? '').trim();
  if (!trimmed) return experiment;
  assertUniqueName(experiment.groups || [], groupId, trimmed, '分组');
  return { ...experiment, groups: experiment.groups.map(g => g.id === groupId ? { ...g, name: trimmed } : g) };
}

export function setCompareToGroup(experiment, groupId, targetGroupId) {
  const tid = targetGroupId && targetGroupId !== groupId ? targetGroupId : null;
  return { ...experiment, groups: experiment.groups.map(g =>
    g.id === groupId ? { ...g, compareToGroupId: tid } : g
  ) };
}

export function removeGroup(experiment, groupId) {
  let groups = experiment.groups.filter(g => g.id !== groupId);
  const firstBaseline = groups.find(g => !g.compareToGroupId || g.compareToGroupId === g.id);
  groups = groups.map(g => {
    let c = g.compareToGroupId;
    if (c === groupId) c = firstBaseline ? firstBaseline.id : null;
    if (c === g.id) c = null;
    return { ...g, compareToGroupId: c };
  });
  if (!groups.some(g => !g.compareToGroupId || g.compareToGroupId === g.id)) {
    if (groups.length) groups[0] = { ...groups[0], compareToGroupId: null };
  }
  return { ...experiment, groups };
}

export function addTargetGene(experiment, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return experiment;
  const allGenes = [...(experiment.targetGenes || []), experiment.refGene].filter(Boolean);
  assertUniqueName(allGenes, null, trimmed, '基因');
  return { ...experiment, targetGenes: [...experiment.targetGenes, createTargetGene(trimmed)] };
}

export function renameTargetGene(experiment, geneId, newName) {
  const trimmed = String(newName ?? '').trim();
  if (!trimmed) return experiment;
  const allGenes = [...(experiment.targetGenes || []), experiment.refGene].filter(Boolean);
  assertUniqueName(allGenes, geneId, trimmed, '基因');
  return { ...experiment, targetGenes: experiment.targetGenes.map(g => g.id === geneId ? { ...g, name: trimmed } : g) };
}

export function removeTargetGene(experiment, geneId) {
  return { ...experiment, targetGenes: experiment.targetGenes.filter(g => g.id !== geneId) };
}

export function setRefGeneName(experiment, newName) {
  const trimmed = String(newName ?? '').trim();
  if (!trimmed) return experiment;
  const allGenes = [...(experiment.targetGenes || []), experiment.refGene].filter(Boolean);
  assertUniqueName(allGenes, experiment.refGene?.id, trimmed, '基因');
  return { ...experiment, refGene: { ...experiment.refGene, name: trimmed } };
}

// ---- Name sync ----

export function syncBlockDisplayNames(blocks, experiment) {
  if (!blocks || !experiment) return blocks;
  return blocks.map(block => ({
    ...block,
    group: resolveGroupName(experiment, block.groupId) || block.group || '',
    gene: resolveGeneName(experiment, block.geneId) || block.gene || ''
  }));
}

export function syncRowDisplayNames(rows, experiment) {
  if (!rows || !experiment) return rows;
  return rows.map(row => ({
    ...row,
    group: resolveGroupName(experiment, row.groupId) || row.group || '',
    gene: resolveGeneName(experiment, row.geneId) || row.gene || ''
  }));
}
