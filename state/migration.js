'use strict';

import { normalizeKey } from '../core/normalize.js';
import { createExperiment, createGroup, createTargetGene, ensureCompareAssignments } from './experiment.js';

export const CURRENT_VERSION = 7;

/**
 * Migrate a raw state object from localStorage to the current version.
 */
export function migrateState(raw) {
  if (!raw || typeof raw !== 'object') return null;

  if (raw._version === CURRENT_VERSION) {
    return normalizeV7(raw);
  }

  // v6 → v7: convert isControl boolean to compareToGroupId
  if (raw._version === 6) {
    let state = migrateV6ToV7(raw);
    state._version = CURRENT_VERSION;
    return normalizeV7(state);
  }

  // v5 and earlier
  let state = { ...raw };

  let experiment = state.experiment || {};
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

  if (Array.isArray(experiment.targetGenes)) {
    experiment.targetGenes = experiment.targetGenes.map((g, i) => {
      if (typeof g === 'string') return createTargetGene(g);
      if (g && g.name && !g.id) return createTargetGene(g.name);
      return g;
    });
  } else {
    experiment.targetGenes = [createTargetGene('IL6')];
  }

  const refName = state.ref || 'GAPDH';
  experiment.refGene = { id: 'ref', name: refName };

  // Convert isControl → compareToGroupId for v5 and earlier
  experiment = convertLegacyControlFlags(experiment);

  state.experiment = experiment;

  if (Array.isArray(state.blocks)) {
    state.blocks = state.blocks.map(b => addEntityIds(b, experiment));
  }
  if (Array.isArray(state.rows)) {
    state.rows = state.rows.map(r => addEntityIds(r, experiment));
  }

  delete state.ref;
  delete state.control;

  state._version = CURRENT_VERSION;
  return normalizeV7(state);
}

// ---- v6 → v7 conversion ----

function migrateV6ToV7(state) {
  if (!state.experiment) return state;
  state.experiment = convertLegacyControlFlags(state.experiment);
  if (Array.isArray(state.blocks)) {
    state.blocks = state.blocks.map(b => { const { isControl, ...rest } = b; return rest; });
  }
  return state;
}

function convertLegacyControlFlags(experiment) {
  const groups = (experiment.groups || []).map(g => {
    // Switch from isControl boolean
    if (!g.hasOwnProperty('compareToGroupId')) {
      return { id: g.id, name: g.name, compareToGroupId: g.isControl ? null : undefined };
    }
    // Already has compareToGroupId — keep but strip isControl
    const { isControl, ...rest } = g;
    return rest;
  });

  if (groups.length === 0) return experiment;

  // Find control group (was isControl:true) or first group
  const controlGroup = groups.find(g => g.compareToGroupId === null);
  const baselineId = controlGroup ? controlGroup.id : groups[0].id;

  // Assign all non-baseline groups to the baseline
  const final = groups.map(g => {
    if (g.compareToGroupId === null || g.compareToGroupId === g.id) return g;
    if (g.compareToGroupId === undefined) return { ...g, compareToGroupId: baselineId };
    return g;
  });

  return { ...experiment, groups: final };
}

// ---- v7 normalization ----

function normalizeV7(state) {
  if (!state.experiment.refGene) {
    state.experiment.refGene = { id: 'ref', name: 'GAPDH' };
  }
  if (!Array.isArray(state.experiment.targetGenes) || !state.experiment.targetGenes.length) {
    state.experiment.targetGenes = [createTargetGene('IL6')];
  }
  state.experiment.targetGenes = state.experiment.targetGenes.map(g => {
    if (!g.id) return createTargetGene(g.name || g);
    return g;
  });
  state.experiment.groups = (state.experiment.groups || []).map((g, i) => {
    const { isControl, ...rest } = g;
    if (!rest.id) return createGroup(rest.name || `Group${i + 1}`, rest.compareToGroupId);
    return rest;
  });
  // Ensure valid compareToGroupId assignments
  state.experiment = ensureCompareAssignments(state.experiment);

  if (Array.isArray(state.blocks)) {
    state.blocks = state.blocks.map(b => addEntityIds(b, state.experiment));
  }
  if (Array.isArray(state.rows)) {
    state.rows = state.rows.map(r => addEntityIds(r, state.experiment));
  }
  state._version = CURRENT_VERSION;
  return state;
}

// ---- ID helpers (unchanged) ----

/** Backfill groupId/geneId on a legacy block or row by matching display names. */
function addEntityIds(entity, experiment) {
  if (entity.groupId && entity.geneId) return entity;
  const groupName = entity.group || '';
  const groupKey = normalizeKey(groupName);
  let groupId = entity.groupId || null;
  if (!groupId) {
    const match = (experiment.groups || []).find(g => normalizeKey(g.name) === groupKey);
    groupId = match ? match.id : null;
  }
  const geneName = entity.gene || '';
  const geneKey = normalizeKey(geneName);
  let geneId = entity.geneId || null;
  if (!geneId) {
    if (experiment.refGene && normalizeKey(experiment.refGene.name) === geneKey) {
      geneId = experiment.refGene.id;
    } else {
      const match = (experiment.targetGenes || []).find(g => normalizeKey(g.name) === geneKey);
      geneId = match ? match.id : null;
    }
  }
  return { ...entity, groupId: groupId || entity.groupId, geneId: geneId || entity.geneId };
}
