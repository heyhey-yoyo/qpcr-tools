'use strict';

import { normalizeKey } from '../core/normalize.js';
import { createExperiment, createGroup, createTargetGene } from './experiment.js';

export const CURRENT_VERSION = 6;

/**
 * Migrate a raw state object from localStorage to the current version.
 *
 * v5 → v6 changes:
 *   1. targetGenes: string[] → [{id, name}]
 *   2. Add refGene: {id: 'ref', name: <state.ref>}
 *   3. Add groupId / geneId to every block
 *   4. Add groupId / geneId to every row
 *   5. Remove top-level `ref` and `control` (now derived from experiment)
 *
 * Returns a fully-migrated state object ready for load().
 */
export function migrateState(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // Already v6+
  if (raw._version === CURRENT_VERSION) {
    // Ensure experiment is consistent
    return normalizeV6(raw);
  }

  // Detect version
  const isV5 = raw.experiment && Array.isArray(raw.experiment.targetGenes) &&
    typeof raw.experiment.targetGenes[0] === 'string';

  // If v5 or earlier with string[] targetGenes
  let state = { ...raw };

  // ---- Convert experiment ----
  let experiment = state.experiment || {};

  // Ensure groups have IDs
  if (!experiment.groups || !Array.isArray(experiment.groups) || experiment.groups.length === 0) {
    experiment.groups = [
      { id: 'g1', name: 'NC', isControl: true },
      { id: 'g2', name: 'Treatment', isControl: false }
    ];
  }
  experiment.groups = experiment.groups.map((g, i) => {
    if (g.id) return g;
    return { ...g, id: 'g' + (i + 1) };
  });

  // Convert targetGenes from string[] to [{id, name}]
  if (Array.isArray(experiment.targetGenes)) {
    experiment.targetGenes = experiment.targetGenes.map((g, i) => {
      if (typeof g === 'string') return createTargetGene(g);
      if (g && g.name && !g.id) return createTargetGene(g.name);
      return g;
    });
  } else {
    experiment.targetGenes = [createTargetGene('IL6')];
  }

  // Add refGene
  const refName = state.ref || 'GAPDH';
  experiment.refGene = { id: 'ref', name: refName };

  state.experiment = experiment;

  // ---- Add IDs to blocks ----
  if (Array.isArray(state.blocks)) {
    state.blocks = state.blocks.map(b => addBlockIds(b, experiment));
  }

  // ---- Add IDs to rows ----
  if (Array.isArray(state.rows)) {
    state.rows = state.rows.map(r => addRowIds(r, experiment));
  }

  // ---- Clean up old top-level fields ----
  delete state.ref;
  delete state.control;

  state._version = CURRENT_VERSION;
  return normalizeV6(state);
}

/**
 * Normalize an already-v6 state to ensure consistency.
 */
function normalizeV6(state) {
  if (!state.experiment.refGene) {
    state.experiment.refGene = { id: 'ref', name: 'GAPDH' };
  }
  if (!Array.isArray(state.experiment.targetGenes) || !state.experiment.targetGenes.length) {
    state.experiment.targetGenes = [createTargetGene('IL6')];
  }
  // Ensure all targetGenes have IDs
  state.experiment.targetGenes = state.experiment.targetGenes.map(g => {
    if (!g.id) return createTargetGene(g.name || g);
    return g;
  });
  // Ensure groups have IDs
  state.experiment.groups = (state.experiment.groups || []).map((g, i) => {
    if (!g.id) return createGroup(g.name, g.isControl);
    return g;
  });
  // Ensure blocks have IDs
  if (Array.isArray(state.blocks)) {
    state.blocks = state.blocks.map(b => addBlockIds(b, state.experiment));
  }
  // Ensure rows have IDs
  if (Array.isArray(state.rows)) {
    state.rows = state.rows.map(r => addRowIds(r, state.experiment));
  }
  state._version = CURRENT_VERSION;
  return state;
}

/**
 * Add groupId and geneId to a block if missing.
 */
function addBlockIds(block, experiment) {
  if (block.groupId && block.geneId) return block;

  // Resolve group
  const groupName = block.group || '';
  const groupKey = normalizeKey(groupName);
  let groupId = block.groupId || null;
  if (!groupId) {
    const match = (experiment.groups || []).find(g => normalizeKey(g.name) === groupKey);
    groupId = match ? match.id : null;
  }

  // Resolve gene
  const geneName = block.gene || '';
  const geneKey = normalizeKey(geneName);
  let geneId = block.geneId || null;
  if (!geneId) {
    if (experiment.refGene && normalizeKey(experiment.refGene.name) === geneKey) {
      geneId = experiment.refGene.id;
    } else {
      const match = (experiment.targetGenes || []).find(g => normalizeKey(g.name) === geneKey);
      geneId = match ? match.id : null;
    }
  }

  return { ...block, groupId: groupId || block.groupId, geneId: geneId || block.geneId };
}

/**
 * Add groupId and geneId to a row if missing.
 */
function addRowIds(row, experiment) {
  if (row.groupId && row.geneId) return row;

  const groupName = row.group || '';
  const groupKey = normalizeKey(groupName);
  let groupId = row.groupId || null;
  if (!groupId) {
    const match = (experiment.groups || []).find(g => normalizeKey(g.name) === groupKey);
    groupId = match ? match.id : null;
  }

  const geneName = row.gene || '';
  const geneKey = normalizeKey(geneName);
  let geneId = row.geneId || null;
  if (!geneId) {
    if (experiment.refGene && normalizeKey(experiment.refGene.name) === geneKey) {
      geneId = experiment.refGene.id;
    } else {
      const match = (experiment.targetGenes || []).find(g => normalizeKey(g.name) === geneKey);
      geneId = match ? match.id : null;
    }
  }

  return { ...row, groupId: groupId || row.groupId, geneId: geneId || row.geneId };
}
