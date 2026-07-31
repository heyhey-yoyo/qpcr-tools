'use strict';

import { rowStats } from './statistics.js';
import { mean } from './statistics.js';
import { normalizeKey } from './normalize.js';

/**
 * Pure-function qPCR analysis: ΔCt / ΔΔCt computation.
 * Supports multiple baseline groups via compareToGroupId.
 *
 * DOES NOT read DOM, localStorage, or global variables.
 *
 * @param {Object} params
 * @param {Array}   params.rows           - Ct data rows, each with { name, groupId, group, geneId, gene, cts[] }
 * @param {Object}  params.experiment     - { groups (with compareToGroupId), targetGenes, refGene }
 * @param {string}  params.mode           - 'ddct' | 'dct'
 * @param {number}  params.maxSpread      - QC threshold for max Ct spread
 * @returns {{ results: Array, notes: { merged: string[], singleRep: string[] }, controlStatsByGene: Map }}
 */
export function computeAnalysis({ rows, experiment, mode, maxSpread }) {
  const refGeneId = experiment.refGene ? experiment.refGene.id : 'ref';

  // ---- Step 1: per-row statistics using parseCt-based validation ----
  const enriched = rows.map(row => ({ ...row, s: rowStats(row.cts) }));

  // ---- Step 2: merge duplicate sample+group+gene records ----
  const mergedByKey = new Map();
  const mergedLabels = new Set();
  enriched.forEach(row => {
    const groupKey = row.groupId ? normalizeKey(row.groupId) : normalizeKey(row.group);
    const geneKey = row.geneId ? normalizeKey(row.geneId) : normalizeKey(row.gene);
    const key = `${row.name}|||${groupKey}|||${geneKey}`;
    if (!mergedByKey.has(key)) {
      mergedByKey.set(key, { ...row, cts: [...row.cts] });
    } else {
      const existing = mergedByKey.get(key);
      existing.cts = existing.cts.concat(row.cts);
      existing.s = rowStats(existing.cts);
      mergedLabels.add(`${row.name} · ${row.gene}`);
    }
  });

  // ---- Step 3: group by sample ----
  const bySample = {};
  [...mergedByKey.values()].forEach(row => {
    const groupKey = row.groupId ? normalizeKey(row.groupId) : normalizeKey(row.group);
    const key = `${row.name}|||${groupKey}`;
    (bySample[key] ||= []).push(row);
  });

  // ---- Step 4: pair targets with their reference within each sample ----
  let output = [];
  const singleRepLabels = new Set();
  Object.values(bySample).forEach(items => {
    // Find reference by stable geneId (fallback: normalized name)
    const reference = items.find(item => {
      if (item.geneId) return item.geneId === refGeneId;
      return normalizeKey(item.gene) === normalizeKey(experiment.refGene.name);
    });

    items.filter(item => {
      if (item.geneId) return item.geneId !== refGeneId;
      return normalizeKey(item.gene) !== normalizeKey(experiment.refGene.name);
    }).forEach(target => {
      if (!reference || !Number.isFinite(reference.s.mean) || !Number.isFinite(target.s.mean)) return;

      const paired = target.s.n >= 2 && reference.s.n >= 2;
      if (!paired) singleRepLabels.add(`${target.name} · ${target.gene}`);

      const dct = target.s.mean - reference.s.mean;
      const techSe = paired
        ? Math.sqrt(
            (target.s.sd ** 2) / target.s.n +
            (reference.s.sd ** 2) / reference.s.n
          )
        : null;

      output.push({
        name: target.name,
        group: target.group,
        groupId: target.groupId || null,
        gene: target.gene,
        geneId: target.geneId || null,
        targetCt: target.s.mean,
        referenceCt: reference.s.mean,
        targetN: target.s.n,
        referenceN: reference.s.n,
        targetTechSd: target.s.sd,
        refTechSd: reference.s.sd,
        targetSpread: target.s.spread,
        referenceSpread: reference.s.spread,
        dct,
        techSem: techSe,
        n: Math.min(target.s.n, reference.s.n)
      });
    });
  });

  // ---- Resolve each item's comparison group from experiment ----
  const groupById = new Map((experiment.groups || []).map(g => [g.id, g]));
  const resolveGroup = item => {
    if (item.groupId && groupById.has(item.groupId)) return groupById.get(item.groupId);
    return (experiment.groups || []).find(
      g => normalizeKey(g.name) === normalizeKey(item.group)
    ) || null;
  };

  // Follow compareToGroupId chains to the ultimate baseline.
  // Returns null if groupId is unknown or the chain leads to a dangling ref.
  const resolveBaseline = (groupId, visited) => {
    visited = visited || new Set();
    if (!groupId || visited.has(groupId)) return null;
    visited.add(groupId);
    const g = groupById.get(groupId);
    if (!g) return null;
    if (!g.compareToGroupId || g.compareToGroupId === g.id) return g.id;
    if (!groupById.has(g.compareToGroupId)) return null; // dangling ref
    return resolveBaseline(g.compareToGroupId, visited);
  };

  const comparisons = output.map(item => {
    const group = resolveGroup(item);
    if (!group) {
      // Unknown group (user-typed name) → its own baseline
      const fallbackId = item.groupId || `name:${normalizeKey(item.group)}`;
      return { compareToGroupId: fallbackId, compareToGroup: item.group, isBaseline: true };
    }
    const baselineId = resolveBaseline(group.id);
    // Dangling chain or self-referencing cycle → treat as its own baseline
    if (!baselineId) {
      return { compareToGroupId: group.id, compareToGroup: group.name, isBaseline: true };
    }
    const baseline = groupById.get(baselineId);
    const isBaseline = baselineId === group.id;
    return {
      compareToGroupId: baselineId,
      compareToGroup: baseline ? baseline.name : group.name,
      isBaseline
    };
  });

  // ---- Step 5: per-baseline ΔCt statistics, per target gene ----
  const controlByBaselineGene = new Map();
  output.forEach((item, i) => {
    if (!comparisons[i].isBaseline) return;
    const baselineGroupId = comparisons[i].compareToGroupId;
    const geneKey = item.geneId || normalizeKey(item.gene);
    const key = `${baselineGroupId}|||${geneKey}`;
    if (!controlByBaselineGene.has(key)) controlByBaselineGene.set(key, []);
    controlByBaselineGene.get(key).push(item);
  });

  const controlStatsByGene = new Map();
  controlByBaselineGene.forEach((items, key) => {
    const dcts = items.map(item => item.dct);
    const avg = mean(dcts);
    let bioSem = null;
    if (items.length > 1) {
      const variance = dcts.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (dcts.length - 1);
      bioSem = Math.sqrt(variance / dcts.length);
    }
    controlStatsByGene.set(key, {
      gene: items[0].gene,
      geneId: items[0].geneId,
      mean: avg,
      bioSem,
      n: items.length
    });
  });

  // ---- Step 6: ΔΔCt and fold change ----
  output = output.map((item, i) => {
    const qc = Math.max(item.targetSpread, item.referenceSpread) <= maxSpread && item.n >= 2;
    const geneKey = item.geneId || normalizeKey(item.gene);
    const cmp = comparisons[i];

    if (mode !== 'ddct') {
      const fold = Math.pow(2, -item.dct);
      return {
        ...item,
        qc,
        ddct: null,
        controlMean: null,
        controlBioSem: null,
        controlN: null,
        error: item.techSem,
        errorType: item.techSem !== null ? 'techSem' : null,
        fold,
        foldLow: Number.isFinite(item.techSem) ? Math.pow(2, -(item.dct + item.techSem)) : fold,
        foldHigh: Number.isFinite(item.techSem) ? Math.pow(2, -(item.dct - item.techSem)) : fold,
        compareToGroupId: cmp.compareToGroupId,
        compareToGroup: cmp.compareToGroup,
        isBaseline: cmp.isBaseline
      };
    }

    const statsKey = `${cmp.compareToGroupId}|||${geneKey}`;
    const controlStats = controlStatsByGene.get(statsKey);

    if (!controlStats || !Number.isFinite(controlStats.mean)) {
      return {
        ...item,
        qc,
        missingControl: true,
        ddct: null,
        controlMean: null,
        controlBioSem: null,
        controlN: null,
        error: null,
        errorType: null,
        fold: null,
        foldLow: null,
        foldHigh: null,
        compareToGroupId: cmp.compareToGroupId,
        compareToGroup: cmp.compareToGroup,
        isBaseline: cmp.isBaseline
      };
    }

    const ddct = item.dct - controlStats.mean;
    const error = cmp.isBaseline ? null : item.techSem;
    const fold = Math.pow(2, -ddct);

    return {
      ...item,
      qc,
      ddct,
      controlMean: controlStats.mean,
      controlBioSem: controlStats.bioSem,
      controlN: controlStats.n,
      error,
      errorType: error !== null ? 'techSem' : null,
      fold,
      foldLow: Number.isFinite(error) ? Math.pow(2, -(ddct + error)) : fold,
      foldHigh: Number.isFinite(error) ? Math.pow(2, -(ddct - error)) : fold,
      compareToGroupId: cmp.compareToGroupId,
      compareToGroup: cmp.compareToGroup,
      isBaseline: cmp.isBaseline
    };
  });

  return {
    results: output,
    notes: { merged: [...mergedLabels], singleRep: [...singleRepLabels] },
    controlStatsByGene
  };
}
