'use strict';

import { normalizeKey } from '../core/normalize.js';

// ---- Factories ----

let _idCounter = 0;
function uid(prefix) {
  _idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${_idCounter.toString(36)}`;
}

export function createGroup(name, isControl) {
  return { id: uid('g'), name: String(name ?? '').trim(), isControl: Boolean(isControl) };
}

export function createTargetGene(name) {
  return { id: uid('tg'), name: String(name ?? '').trim() };
}

/** Default experiment with a fresh ref-gene ID. */
export function createExperiment(overrides) {
  return {
    groups: [
      { id: uid('g'), name: 'NC', isControl: true },
      { id: uid('g'), name: 'Treatment', isControl: false }
    ],
    biologicalReplicates: 1,
    targetGenes: [{ id: uid('tg'), name: 'IL6' }],
    refGene: { id: 'ref', name: 'GAPDH' },
    ...overrides
  };
}

// ---- Resolvers ----

/** Resolve a display name from a gene ID. Returns empty string if not found. */
export function resolveGeneName(experiment, geneId) {
  if (!geneId || !experiment) return '';
  if (experiment.refGene && experiment.refGene.id === geneId) return experiment.refGene.name;
  const tg = (experiment.targetGenes || []).find(g => g.id === geneId);
  return tg ? tg.name : '';
}

/** Resolve a display name from a group ID. Returns empty string if not found. */
export function resolveGroupName(experiment, groupId) {
  if (!groupId || !experiment) return '';
  const g = (experiment.groups || []).find(g => g.id === groupId);
  return g ? g.name : '';
}

/**
 * Find or create a gene ID for a given name.
 * Matches by normalized name against refGene and targetGenes.
 * Returns { id, name, isRef } — if no match found, generates a new ad-hoc ID.
 */
export function resolveGeneId(experiment, name) {
  if (!experiment) return { id: uid('tg'), name: String(name ?? ''), isRef: false };
  const key = normalizeKey(name);
  if (experiment.refGene && normalizeKey(experiment.refGene.name) === key) {
    return { id: experiment.refGene.id, name: experiment.refGene.name, isRef: true };
  }
  const tg = (experiment.targetGenes || []).find(g => normalizeKey(g.name) === key);
  if (tg) return { id: tg.id, name: tg.name, isRef: false };
  // No match — generate ad-hoc ID (not added to experiment config)
  return { id: uid('tg'), name: String(name ?? '').trim(), isRef: false };
}

/**
 * Find or create a group ID for a given name.
 * Matches by normalized name against experiment.groups.
 */
export function resolveGroupId(experiment, name) {
  if (!experiment) return { id: uid('g'), name: String(name ?? '') };
  const key = normalizeKey(name);
  const g = (experiment.groups || []).find(g => normalizeKey(g.name) === key);
  if (g) return { id: g.id, name: g.name };
  // No match — generate ad-hoc ID
  return { id: uid('g'), name: String(name ?? '').trim() };
}

// ---- Queries ----

export function getControlGroup(experiment) {
  return (experiment && experiment.groups || []).find(g => g.isControl) || null;
}

export function getControlGroupId(experiment) {
  const cg = getControlGroup(experiment);
  return cg ? cg.id : null;
}

// ---- Mutations (return new experiment, do not mutate input) ----

export function addGroup(experiment, name) {
  const g = createGroup(name, !experiment.groups.some(g => g.isControl));
  return { ...experiment, groups: [...experiment.groups, g] };
}

export function renameGroup(experiment, groupId, newName) {
  const trimmed = String(newName ?? '').trim();
  if (!trimmed) return experiment;
  return {
    ...experiment,
    groups: experiment.groups.map(g =>
      g.id === groupId ? { ...g, name: trimmed } : g
    )
  };
}

export function toggleControlGroup(experiment, groupId) {
  return {
    ...experiment,
    groups: experiment.groups.map(g => ({
      ...g,
      isControl: g.id === groupId
    }))
  };
}

export function removeGroup(experiment, groupId) {
  const groups = experiment.groups.filter(g => g.id !== groupId);
  // If we removed the control group, make the first remaining one control
  if (!groups.some(g => g.isControl) && groups.length > 0) {
    groups[0] = { ...groups[0], isControl: true };
  }
  return { ...experiment, groups };
}

export function addTargetGene(experiment, name) {
  return {
    ...experiment,
    targetGenes: [...experiment.targetGenes, createTargetGene(name)]
  };
}

export function renameTargetGene(experiment, geneId, newName) {
  const trimmed = String(newName ?? '').trim();
  if (!trimmed) return experiment;
  return {
    ...experiment,
    targetGenes: experiment.targetGenes.map(g =>
      g.id === geneId ? { ...g, name: trimmed } : g
    )
  };
}

export function removeTargetGene(experiment, geneId) {
  return {
    ...experiment,
    targetGenes: experiment.targetGenes.filter(g => g.id !== geneId)
  };
}

export function setRefGeneName(experiment, newName) {
  const trimmed = String(newName ?? '').trim();
  if (!trimmed) return experiment;
  return {
    ...experiment,
    refGene: { ...experiment.refGene, name: trimmed }
  };
}

// ---- Name sync: update stale display names on blocks / rows after a rename ----

/**
 * Update block display names to match the current experiment config.
 * Blocks store both groupId/geneId (stable) and group/gene (display).
 * This function resolves IDs and updates the display names.
 */
export function syncBlockDisplayNames(blocks, experiment) {
  if (!blocks || !experiment) return blocks;
  return blocks.map(b => ({
    ...b,
    group: resolveGroupName(experiment, b.groupId) || b.group || '',
    gene: resolveGeneName(experiment, b.geneId) || b.gene || ''
  }));
}

/**
 * Update row display names to match the current experiment config.
 */
export function syncRowDisplayNames(rows, experiment) {
  if (!rows || !experiment) return rows;
  return rows.map(r => ({
    ...r,
    group: resolveGroupName(experiment, r.groupId) || r.group || '',
    gene: resolveGeneName(experiment, r.geneId) || r.gene || ''
  }));
}
