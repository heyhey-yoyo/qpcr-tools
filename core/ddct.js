'use strict';

import { rowStats } from './statistics.js';
import { mean } from './statistics.js';
import { normalizeKey } from './normalize.js';

/**
 * Pure-function qPCR analysis: ΔCt / ΔΔCt computation.
 *
 * DOES NOT read DOM, localStorage, or global variables.
 * All required data is passed as arguments.
 *
 * @param {Object} params
 * @param {Array}   params.rows           - Ct data rows, each with { name, groupId, group, geneId, gene, cts[] }
 * @param {Object}  params.experiment     - { groups, targetGenes, refGene }
 * @param {string}  params.mode           - 'ddct' | 'dct'
 * @param {number}  params.maxSpread      - QC threshold for max Ct spread
 * @returns {{ results: Array, notes: { merged: string[], singleRep: string[] }, controlStatsByGene: Map }}
 */
export function computeAnalysis({ rows, experiment, mode, maxSpread }) {
  const refGeneId = experiment.refGene ? experiment.refGene.id : 'ref';
  const controlGroup = (experiment.groups || []).find(g => g.isControl);
  const controlGroupId = controlGroup ? controlGroup.id : null;

  // ---- Step 1: per-row statistics using parseCt-based validation ----
  const enriched = rows.map(row => ({ ...row, s: rowStats(row.cts) }));

  // ---- Step 2: merge duplicate sample+group+gene records ----
  // (kept as-is per user constraint — string-based merge key)
  const mergedByKey = new Map();
  const mergedLabels = new Set();
  enriched.forEach(row => {
    // Use geneId if available, fall back to normalized gene name for the merge key.
    // The merge key format stays string-based as requested.
    const geneKey = row.geneId ? normalizeKey(row.geneId) : normalizeKey(row.gene);
    const key = `${row.name}|||${row.group}|||${geneKey}`;
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
    const key = `${row.name}|||${row.group}`;
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
        // Raw statistics
        targetCt: target.s.mean,
        referenceCt: reference.s.mean,
        targetN: target.s.n,
        referenceN: reference.s.n,
        targetTechSd: target.s.sd,
        refTechSd: reference.s.sd,
        targetSpread: target.s.spread,
        referenceSpread: reference.s.spread,
        // ΔCt
        dct,
        // Technical SEM of ΔCt (propagated from target + ref independent wells)
        techSem: techSe,
        n: Math.min(target.s.n, reference.s.n)
      });
    });
  });

  // ---- Step 5: control group ΔCt statistics, per target gene ----
  const controlByGene = new Map();
  output.forEach(item => {
    // Match to control group by stable groupId (fallback: normalized name)
    const isControl = item.groupId
      ? item.groupId === controlGroupId
      : normalizeKey(item.group) === normalizeKey(controlGroup ? controlGroup.name : '');

    if (!isControl) return;

    // Key by stable geneId (fallback: normalized gene name)
    const geneKey = item.geneId || normalizeKey(item.gene);
    if (!controlByGene.has(geneKey)) controlByGene.set(geneKey, []);
    controlByGene.get(geneKey).push(item);
  });

  const controlStatsByGene = new Map();
  controlByGene.forEach((items, geneKey) => {
    const dcts = items.map(item => item.dct);
    const avg = mean(dcts);
    let seVal;
    if (items.length > 1) {
      const variance = dcts.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (dcts.length - 1);
      seVal = Math.sqrt(variance / dcts.length);
    } else {
      seVal = items[0].techSem;
    }
    controlStatsByGene.set(geneKey, {
      gene: items[0].gene,
      geneId: items[0].geneId,
      mean: avg,
      // Between-sample SEM of control ΔCt (biological variation)
      bioSem: seVal,
      n: items.length
    });
  });

  // ---- Step 6: ΔΔCt and fold change ----
  output = output.map(item => {
    const qc = Math.max(item.targetSpread, item.referenceSpread) <= maxSpread && item.n >= 2;
    const geneKey = item.geneId || normalizeKey(item.gene);

    if (mode !== 'ddct') {
      // ΔCt mode: 2^-ΔCt
      const fold = Math.pow(2, -item.dct);
      return {
        ...item,
        qc,
        ddct: null,
        controlMean: null,
        controlBioSem: null,
        controlN: null,
        // Error bars show technical SEM of ΔCt
        error: item.techSem,
        errorType: item.techSem !== null ? 'techSem' : null,
        fold,
        foldLow: Number.isFinite(item.techSem) ? Math.pow(2, -(item.dct + item.techSem)) : fold,
        foldHigh: Number.isFinite(item.techSem) ? Math.pow(2, -(item.dct - item.techSem)) : fold
      };
    }

    // ΔΔCt mode
    const controlStats = controlStatsByGene.get(geneKey);
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
        foldHigh: null
      };
    }

    const ddct = item.dct - controlStats.mean;

    // Determine if this sample is in the control group
    const isControl = item.groupId
      ? item.groupId === controlGroupId
      : normalizeKey(item.group) === normalizeKey(controlGroup ? controlGroup.name : '');

    // Error bars show only the sample's technical SEM of ΔCt.
    // Control group samples are the baseline — no error bars.
    // controlStats.bioSem is between-sample biological variation, reported
    // separately; it must NOT be merged into the technical error bars.
    const error = isControl ? null : item.techSem;
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
      foldHigh: Number.isFinite(error) ? Math.pow(2, -(ddct - error)) : fold
    };
  });

  return {
    results: output,
    notes: { merged: [...mergedLabels], singleRep: [...singleRepLabels] },
    controlStatsByGene
  };
}
