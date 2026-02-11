/**
 * Simulation Routes
 * Orchestrates full aerodynamic simulations across multiple services
 */

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const { createServiceClient, retryRequest } = require('../utils/serviceClient');
const { physics: physicsConfig, ml: mlConfig, quantum: quantumConfig } = require('../config/services');
const { cache } = require('../config/redis');
const { createCFDAdapter } = require('../services/cfdAdapter');

const physicsClient = createServiceClient(
  'Physics Engine',
  physicsConfig.baseUrl,
  physicsConfig.timeout
);
const mlClient = createServiceClient(
  'ML Surrogate',
  mlConfig.baseUrl,
  mlConfig.timeout
);
const quantumClient = createServiceClient(
  'Quantum Optimizer',
  quantumConfig.baseUrl,
  quantumConfig.timeout
);
const cfdAdapter = createCFDAdapter({
  engineType: process.env.CFD_ENGINE,
  baseUrl: process.env.CFD_SERVICE_URL,
});

const simulationStore = new Map();
const activeSimulationJobs = new Map();
const MAX_STORED_SIMULATIONS = 200;
const SIMULATION_CACHE_TTL_SECONDS = 24 * 3600;
const PARETO_DEFAULT_LIMIT_RUNS = 40;
const PARETO_MAX_POINTS = 240;
const CANDIDATE_DEFAULT_COUNT = 60;
const CANDIDATE_MAX_COUNT = 1000;
const WORKFLOW_TIMELINE_STAGES = [
  { id: 'physics', name: 'Physics Validator', workflowKey: 'physics' },
  { id: 'ml', name: 'ML Surrogate', workflowKey: 'ml' },
  { id: 'quantum', name: 'Quantum Optimizer', workflowKey: 'quantum' },
  { id: 'cfd_proxy', name: 'CFD Coupling', workflowKey: 'cfd_proxy' },
  { id: 'analysis', name: 'Analysis Agent', workflowKey: null },
  { id: 'report', name: 'Report Generator', workflowKey: null },
];
const TERMINAL_STAGE_STATUSES = new Set(['completed', 'degraded', 'failed', 'skipped']);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFixedNumber(value, decimals = 6) {
  return Number(Number(value).toFixed(decimals));
}

function coerceFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeStageStatus(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'running') return 'running';
  if (raw === 'completed') return 'completed';
  if (raw === 'degraded') return 'degraded';
  if (raw === 'failed') return 'failed';
  if (raw === 'skipped') return 'skipped';
  return 'pending';
}

function computeDurationSeconds(startedAtIso, completedAtIso) {
  if (!startedAtIso || !completedAtIso) {
    return null;
  }
  const startedMs = new Date(startedAtIso).getTime();
  const completedMs = new Date(completedAtIso).getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs) || completedMs < startedMs) {
    return null;
  }
  return toFixedNumber((completedMs - startedMs) / 1000, 3);
}

function createEmptyTimelineState(workflow = {}, startedAtIso = null) {
  const timeline = {};
  WORKFLOW_TIMELINE_STAGES.forEach((stage) => {
    const initialStatus = stage.workflowKey
      ? normalizeStageStatus(workflow?.[stage.workflowKey])
      : 'pending';
    timeline[stage.id] = {
      id: stage.id,
      name: stage.name,
      status: initialStatus,
      started_at: null,
      completed_at: null,
      duration_s: null,
      details: {},
    };
  });

  if (timeline.physics && startedAtIso) {
    timeline.physics.status = 'running';
    timeline.physics.started_at = startedAtIso;
  }

  if (timeline.quantum && normalizeStageStatus(workflow.quantum) === 'skipped') {
    timeline.quantum.status = 'skipped';
  }

  return timeline;
}

function updateTimelineStage(timeline, stageId, status, at = new Date(), details = {}) {
  if (!timeline || !timeline[stageId]) {
    return;
  }
  const stage = timeline[stageId];
  const normalizedStatus = normalizeStageStatus(status);
  const atIso = at instanceof Date ? at.toISOString() : new Date(at).toISOString();

  if (normalizedStatus === 'running') {
    if (!stage.started_at) {
      stage.started_at = atIso;
    }
  } else if (normalizedStatus === 'skipped') {
    stage.started_at = null;
    stage.completed_at = null;
    stage.duration_s = null;
  } else {
    if (!stage.started_at) {
      stage.started_at = atIso;
    }
    if (TERMINAL_STAGE_STATUSES.has(normalizedStatus)) {
      stage.completed_at = atIso;
      stage.duration_s = computeDurationSeconds(stage.started_at, stage.completed_at);
    }
  }

  stage.status = normalizedStatus;
  if (details && typeof details === 'object' && Object.keys(details).length > 0) {
    stage.details = {
      ...stage.details,
      ...details,
    };
  }
}

function toTimelinePayload(timelineState) {
  return WORKFLOW_TIMELINE_STAGES.map((stage) => {
    const stageState = timelineState?.[stage.id] || {};
    return {
      id: stage.id,
      name: stage.name,
      status: normalizeStageStatus(stageState.status),
      started_at: stageState.started_at || null,
      completed_at: stageState.completed_at || null,
      duration_s: coerceFiniteNumber(stageState.duration_s, null),
      details: stageState.details && typeof stageState.details === 'object' ? stageState.details : {},
    };
  });
}

function inferTimelineFromRecord(record) {
  const workflow = record?.workflow || {};
  return WORKFLOW_TIMELINE_STAGES.map((stage) => {
    const inferredStatus = stage.workflowKey
      ? normalizeStageStatus(workflow[stage.workflowKey])
      : (
        ['completed', 'degraded'].includes(record?.status)
          ? 'completed'
          : (record?.status === 'failed' ? 'failed' : 'pending')
      );

    return {
      id: stage.id,
      name: stage.name,
      status: inferredStatus,
      started_at: null,
      completed_at: null,
      duration_s: null,
      details: {},
    };
  });
}

function getTimelineStages(record) {
  if (Array.isArray(record?.workflow_timeline) && record.workflow_timeline.length > 0) {
    const indexed = new Map(record.workflow_timeline.map((stage) => [stage.id, stage]));
    return WORKFLOW_TIMELINE_STAGES.map((stage) => {
      const value = indexed.get(stage.id) || {};
      return {
        id: stage.id,
        name: stage.name,
        status: normalizeStageStatus(value.status),
        started_at: value.started_at || null,
        completed_at: value.completed_at || null,
        duration_s: coerceFiniteNumber(value.duration_s, null),
        details: value.details && typeof value.details === 'object' ? value.details : {},
      };
    });
  }

  return inferTimelineFromRecord(record);
}

function normalizeGeometry(geometry = {}) {
  return {
    span: Number.isFinite(geometry.span) ? geometry.span : 1.2,
    chord: Number.isFinite(geometry.chord) ? geometry.chord : 0.28,
    twist: Number.isFinite(geometry.twist) ? geometry.twist : 0.0,
    dihedral: Number.isFinite(geometry.dihedral) ? geometry.dihedral : 0.0,
    sweep: Number.isFinite(geometry.sweep) ? geometry.sweep : 6.0,
    taper_ratio: Number.isFinite(geometry.taper_ratio) ? geometry.taper_ratio : 0.75,
  };
}

function normalizeConditions(conditions = {}) {
  return {
    velocity: Number.isFinite(conditions.velocity) ? conditions.velocity : 72.0,
    alpha: Number.isFinite(conditions.alpha) ? conditions.alpha : 4.5,
    yaw: Number.isFinite(conditions.yaw) ? conditions.yaw : 0.5,
    rho: Number.isFinite(conditions.rho) ? conditions.rho : 1.225,
    n_panels_x: Number.isFinite(conditions.n_panels_x) ? clamp(Math.round(conditions.n_panels_x), 5, 40) : 20,
    n_panels_y: Number.isFinite(conditions.n_panels_y) ? clamp(Math.round(conditions.n_panels_y), 5, 30) : 10,
  };
}

function normalizeCouplingIterations(rawValue, fallback = 4) {
  if (Number.isFinite(rawValue)) {
    return clamp(Math.round(rawValue), 1, 20);
  }
  return fallback;
}

function buildMlFallback(vlmResult, conditions) {
  const alphaScale = 1 + (conditions.alpha / 25);
  return {
    cl: Number((vlmResult.cl * (0.95 + 0.03 * alphaScale)).toFixed(6)),
    cd: Number((vlmResult.cd * (1.03 + 0.015 * Math.abs(conditions.yaw))).toFixed(6)),
    cm: Number((vlmResult.cm * 1.02).toFixed(6)),
    confidence: 0.45,
    inference_time_ms: 0.25,
    cached: false,
    gpu_used: false,
    source: 'fallback_from_vlm',
  };
}

function buildCfdProxy(vlmResult, mlResult, conditions) {
  const yawPenalty = 1 + 0.01 * Math.abs(conditions.yaw);
  const cl = (0.7 * vlmResult.cl + 0.3 * mlResult.cl) * 0.99;
  const cd = (0.7 * vlmResult.cd + 0.3 * mlResult.cd) * yawPenalty * 1.02;
  const cm = 0.6 * vlmResult.cm + 0.4 * mlResult.cm;
  return {
    cl: toFixedNumber(cl),
    cd: toFixedNumber(cd),
    cm: toFixedNumber(cm),
    l_over_d: toFixedNumber(cl / Math.max(cd, 1e-6)),
    source: 'cfd_surrogate_proxy',
    note: 'CFD proxy derived from VLM + ML until full CFD job runner is connected',
  };
}

async function evaluateCfdMetrics({
  simulationId,
  stage,
  iteration,
  useCfdAdapter,
  vlmResult,
  mlResult,
  conditions,
  targetMetrics,
  selectedRatio = 0,
}) {
  const proxyInput = targetMetrics
    ? {
        ...vlmResult,
        cl: targetMetrics.cl,
        cd: targetMetrics.cd,
        cm: targetMetrics.cm,
      }
    : vlmResult;

  const proxyMetrics = buildCfdProxy(proxyInput, mlResult, conditions);

  if (!useCfdAdapter) {
    return {
      metrics: proxyMetrics,
      cfd_job_id: null,
      cfd_engine: 'proxy',
      cfd_solver: 'surrogate_proxy',
      residual_l2: null,
      degraded: false,
    };
  }

  try {
    const evaluation = await cfdAdapter.evaluateCase(
      {
        simulation_id: simulationId,
        stage,
        iteration,
        conditions,
        target_metrics: targetMetrics || {
          cl: proxyInput.cl,
          cd: proxyInput.cd,
          cm: proxyInput.cm,
        },
        selected_ratio: selectedRatio,
      },
      {
        timeoutMs: Number.isFinite(Number(process.env.CFD_TIMEOUT_MS))
          ? Number(process.env.CFD_TIMEOUT_MS)
          : 45000,
        pollIntervalMs: 250,
      }
    );

    const resultMetrics = evaluation?.completed?.result?.metrics;
    if (!resultMetrics || !Number.isFinite(resultMetrics.cl) || !Number.isFinite(resultMetrics.cd)) {
      throw new Error('CFD adapter returned invalid metrics payload');
    }

    const cl = toFixedNumber(resultMetrics.cl);
    const cd = toFixedNumber(Math.max(resultMetrics.cd, 1e-6));
    const cm = toFixedNumber(Number.isFinite(resultMetrics.cm) ? resultMetrics.cm : proxyMetrics.cm);

    return {
      metrics: {
        cl,
        cd,
        cm,
        l_over_d: toFixedNumber(cl / Math.max(cd, 1e-6)),
        source: 'cfd_adapter',
        note: proxyMetrics.note,
      },
      cfd_job_id: evaluation.submission.job_id,
      cfd_engine: evaluation.completed.engine || cfdAdapter.engineName,
      cfd_solver: resultMetrics.solver || 'unknown',
      residual_l2: Number.isFinite(resultMetrics.residual_l2) ? resultMetrics.residual_l2 : null,
      degraded: false,
    };
  } catch (error) {
    logger.warn(`CFD adapter fallback to proxy for ${simulationId} (${stage}): ${error.message}`);
    return {
      metrics: {
        ...proxyMetrics,
        source: 'cfd_adapter_fallback_proxy',
      },
      cfd_job_id: null,
      cfd_engine: 'proxy-fallback',
      cfd_solver: 'surrogate_proxy',
      residual_l2: null,
      degraded: true,
      error: error.message,
    };
  }
}

function buildNodeQubo(nodes, options = {}) {
  const dragWeight = Number.isFinite(options.dragWeight) ? options.dragWeight : 1.0;
  const liftWeight = Number.isFinite(options.liftWeight) ? options.liftWeight : 1.0;
  const maxNodes = Number.isFinite(options.maxNodes)
    ? clamp(Math.round(options.maxNodes), 4, 40)
    : 24;

  const activeNodes = nodes.slice(0, maxNodes);
  const n = activeNodes.length;
  const quboMatrix = Array.from({ length: n }, () => Array(n).fill(0));

  if (n === 0) {
    return { quboMatrix, activeNodes };
  }

  const maxLift = Math.max(...activeNodes.map((node) => Math.abs(node.lift || 0)), 1e-6);
  const maxDrag = Math.max(...activeNodes.map((node) => Math.abs(node.drag || 0)), 1e-6);

  for (let i = 0; i < n; i += 1) {
    const nodeI = activeNodes[i];
    const normalizedLift = Math.max(nodeI.lift || 0, 0) / maxLift;
    const normalizedDrag = Math.abs(nodeI.drag || 0) / maxDrag;

    // Lower objective values are preferred by QUBO solver.
    quboMatrix[i][i] = dragWeight * normalizedDrag - liftWeight * normalizedLift;

    for (let j = i + 1; j < n; j += 1) {
      const nodeJ = activeNodes[j];
      const positionI = nodeI.position || [0, 0, 0];
      const positionJ = nodeJ.position || [0, 0, 0];
      const dx = positionI[0] - positionJ[0];
      const dy = positionI[1] - positionJ[1];
      const dz = positionI[2] - positionJ[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Smoothness coupling penalizes selecting distant nodes simultaneously.
      const coupling = 0.02 / (1 + distance);
      quboMatrix[i][j] = coupling;
      quboMatrix[j][i] = coupling;
    }
  }

  return { quboMatrix, activeNodes };
}

function applyNodeOptimization(baseMetrics, selectedNodes, totalNodes) {
  const selectionRatio = totalNodes > 0 ? selectedNodes.length / totalNodes : 0;
  const liftBoost = 1 + Math.min(0.12, 0.03 + 0.12 * selectionRatio);
  const dragReduction = 1 - Math.min(0.10, 0.02 + 0.10 * selectionRatio);

  const optimizedCl = baseMetrics.cl * liftBoost;
  const optimizedCd = Math.max(baseMetrics.cd * dragReduction, 1e-6);

  return {
    cl: toFixedNumber(optimizedCl),
    cd: toFixedNumber(optimizedCd),
    cm: toFixedNumber(baseMetrics.cm * (1 - 0.03 * selectionRatio)),
    l_over_d: toFixedNumber(optimizedCl / optimizedCd),
    selected_ratio: toFixedNumber(selectionRatio, 4),
    selected_nodes: selectedNodes.length,
  };
}

function mutateNodesForNextIteration(nodes, selectedNodeIds, iterationIndex, totalIterations) {
  const selectedSet = new Set(selectedNodeIds);
  const progress = totalIterations > 0 ? (iterationIndex + 1) / totalIterations : 1;

  return nodes.map((node) => {
    const selected = selectedSet.has(node.node_id);
    const liftGain = selected ? 1 + 0.05 * progress : 1 - 0.01 * progress;
    const dragGain = selected ? 1 - 0.04 * progress : 1 + 0.01 * progress;
    const gammaGain = selected ? 1 + 0.03 * progress : 1 - 0.005 * progress;

    const force = Array.isArray(node.force_vector) ? node.force_vector : [0, 0, 0];

    return {
      ...node,
      lift: toFixedNumber((node.lift || 0) * liftGain),
      drag: toFixedNumber((node.drag || 0) * dragGain),
      gamma: toFixedNumber((node.gamma || 0) * gammaGain),
      cp: toFixedNumber((node.cp || 0) * (selected ? 0.98 : 1.01)),
      force_vector: [
        toFixedNumber(force[0] * dragGain),
        toFixedNumber(force[1]),
        toFixedNumber(force[2] * liftGain),
      ],
    };
  });
}

function buildNodeAnalytics(nodes = [], selectedNodeIds = []) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return {
      total_nodes: 0,
      selected_nodes: 0,
      selected_ratio: 0,
      top_lift_nodes: [],
      top_drag_nodes: [],
      spanwise_distribution: [],
      lift_drag_correlation: null,
    };
  }

  const selectedSet = new Set(selectedNodeIds);
  const safeNodes = nodes.map((node) => ({
    ...node,
    lift: Number(node.lift || 0),
    drag: Number(node.drag || 0),
    span_index: Number.isFinite(Number(node.span_index)) ? Number(node.span_index) : 0,
  }));

  const topLift = [...safeNodes]
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 10)
    .map((node) => ({
      node_id: node.node_id,
      span_index: node.span_index,
      chord_index: node.chord_index,
      lift: toFixedNumber(node.lift),
      drag: toFixedNumber(node.drag),
      selected: selectedSet.has(node.node_id),
    }));

  const topDrag = [...safeNodes]
    .sort((a, b) => Math.abs(b.drag) - Math.abs(a.drag))
    .slice(0, 10)
    .map((node) => ({
      node_id: node.node_id,
      span_index: node.span_index,
      chord_index: node.chord_index,
      lift: toFixedNumber(node.lift),
      drag: toFixedNumber(node.drag),
      selected: selectedSet.has(node.node_id),
    }));

  const spanwiseMap = new Map();
  safeNodes.forEach((node) => {
    const key = node.span_index;
    if (!spanwiseMap.has(key)) {
      spanwiseMap.set(key, {
        span_index: key,
        nodes: 0,
        selected_nodes: 0,
        total_lift: 0,
        total_drag: 0,
      });
    }

    const bucket = spanwiseMap.get(key);
    bucket.nodes += 1;
    bucket.total_lift += node.lift;
    bucket.total_drag += Math.abs(node.drag);
    if (selectedSet.has(node.node_id)) {
      bucket.selected_nodes += 1;
    }
  });

  const spanwiseDistribution = [...spanwiseMap.values()]
    .sort((a, b) => a.span_index - b.span_index)
    .map((bucket) => ({
      span_index: bucket.span_index,
      nodes: bucket.nodes,
      selected_nodes: bucket.selected_nodes,
      selected_ratio: bucket.nodes > 0 ? toFixedNumber(bucket.selected_nodes / bucket.nodes, 4) : 0,
      avg_lift: bucket.nodes > 0 ? toFixedNumber(bucket.total_lift / bucket.nodes) : 0,
      avg_drag: bucket.nodes > 0 ? toFixedNumber(bucket.total_drag / bucket.nodes) : 0,
      l_over_d:
        bucket.total_drag > 0
          ? toFixedNumber(bucket.total_lift / Math.max(bucket.total_drag, 1e-6))
          : null,
    }));

  const n = safeNodes.length;
  const meanLift = safeNodes.reduce((sum, node) => sum + node.lift, 0) / n;
  const meanDrag = safeNodes.reduce((sum, node) => sum + Math.abs(node.drag), 0) / n;
  let covariance = 0;
  let liftVariance = 0;
  let dragVariance = 0;

  safeNodes.forEach((node) => {
    const dLift = node.lift - meanLift;
    const dDrag = Math.abs(node.drag) - meanDrag;
    covariance += dLift * dDrag;
    liftVariance += dLift * dLift;
    dragVariance += dDrag * dDrag;
  });

  const denominator = Math.sqrt(liftVariance * dragVariance);
  const correlation = denominator > 0 ? covariance / denominator : null;

  return {
    total_nodes: safeNodes.length,
    selected_nodes: selectedNodeIds.length,
    selected_ratio: safeNodes.length > 0 ? toFixedNumber(selectedNodeIds.length / safeNodes.length, 4) : 0,
    top_lift_nodes: topLift,
    top_drag_nodes: topDrag,
    spanwise_distribution: spanwiseDistribution,
    lift_drag_correlation: correlation === null ? null : toFixedNumber(correlation, 4),
  };
}

function summarizeWorkflow(workflow) {
  const states = Object.values(workflow);
  if (states.includes('failed')) {
    return 'failed';
  }
  if (states.includes('degraded')) {
    return 'degraded';
  }
  return 'completed';
}

function extractAerodynamicMetrics(record, preferredSource = 'optimized') {
  const baseline = record?.baseline || {};
  const optimization = record?.optimization || {};

  const optimized = optimization?.cfd_proxy_optimized || optimization?.optimized_metrics || null;
  const baselineProxy = baseline?.cfd_proxy || baseline?.vlm || null;

  const ordered = preferredSource === 'baseline'
    ? [baselineProxy, optimized]
    : [optimized, baselineProxy];

  for (const metrics of ordered) {
    const cl = coerceFiniteNumber(metrics?.cl, null);
    const cd = coerceFiniteNumber(metrics?.cd, null);
    if (!Number.isFinite(cl) || !Number.isFinite(cd) || cd <= 0) {
      continue;
    }
    const cm = coerceFiniteNumber(metrics?.cm, 0);
    const lOverD = coerceFiniteNumber(metrics?.l_over_d, cl / Math.max(cd, 1e-6));
    return {
      cl: toFixedNumber(cl),
      cd: toFixedNumber(cd),
      cm: toFixedNumber(cm),
      l_over_d: toFixedNumber(lOverD),
    };
  }

  return null;
}

function estimateFlutterMargin(metrics, geometry = {}, selectedRatio = 0) {
  const lOverD = coerceFiniteNumber(metrics?.l_over_d, 0);
  const sweep = Math.abs(coerceFiniteNumber(geometry?.sweep, 6));
  const twist = Math.abs(coerceFiniteNumber(geometry?.twist, 0));
  const ratioBonus = clamp(coerceFiniteNumber(selectedRatio, 0), 0, 1) * 0.2;
  const margin = 1.1 + clamp(lOverD / 18, 0, 0.7) + ratioBonus - sweep * 0.01 - twist * 0.01;
  return toFixedNumber(clamp(margin, 0.9, 2.4), 3);
}

function estimateMass(geometry = {}, selectedRatio = 0) {
  const span = coerceFiniteNumber(geometry?.span, 1.2);
  const chord = coerceFiniteNumber(geometry?.chord, 0.28);
  const taperRatio = clamp(coerceFiniteNumber(geometry?.taper_ratio, 0.75), 0.25, 1.25);
  const twist = Math.abs(coerceFiniteNumber(geometry?.twist, 0));
  const dihedral = Math.abs(coerceFiniteNumber(geometry?.dihedral, 0));
  const structuralMass = 2.8 + span * 0.45 + chord * 2.2 + (1 - taperRatio) * 0.8;
  const anglePenalty = twist * 0.03 + dihedral * 0.02;
  const optimizationMassPenalty = clamp(coerceFiniteNumber(selectedRatio, 0), 0, 1) * 0.25;
  return toFixedNumber(clamp(structuralMass + anglePenalty + optimizationMassPenalty, 2.8, 7.5), 3);
}

function buildParetoDesignPoint(record, metrics, source, indexHint) {
  if (!metrics) {
    return null;
  }
  const geometry = normalizeGeometry(record?.geometry || {});
  const selectedRatio = coerceFiniteNumber(record?.optimization?.optimized_metrics?.selected_ratio, 0);
  const downforce = toFixedNumber(Math.max(metrics.cl, 0));
  const drag = toFixedNumber(Math.max(metrics.cd, 1e-6));
  const lOverD = toFixedNumber(downforce / Math.max(drag, 1e-6));
  const flutterMargin = estimateFlutterMargin(metrics, geometry, selectedRatio);
  const mass = estimateMass(geometry, selectedRatio);
  const feasible = flutterMargin >= 1.2 && mass <= 6.5 && drag <= 1.2 && downforce >= 0.2;

  return {
    id: `${record.simulation_id}_${source}_${indexHint}`,
    simulation_id: record.simulation_id,
    name: `${record.simulation_id.slice(-8)} ${source}`,
    source,
    status: record.status,
    drag,
    downforce,
    flutter_margin: flutterMargin,
    mass,
    L_D: lOverD,
    selected_ratio: toFixedNumber(selectedRatio, 4),
    feasible,
    isParetoOptimal: false,
    completed_at: record.completed_at || null,
  };
}

function dominatesDesign(candidate, target) {
  const noWorse = (
    candidate.drag <= target.drag
    && candidate.downforce >= target.downforce
    && candidate.flutter_margin >= target.flutter_margin
  );
  const strictlyBetter = (
    candidate.drag < target.drag
    || candidate.downforce > target.downforce
    || candidate.flutter_margin > target.flutter_margin
  );
  return noWorse && strictlyBetter;
}

function annotateParetoFrontier(designs) {
  return designs.map((design, idx) => {
    if (!design.feasible) {
      return {
        ...design,
        isParetoOptimal: false,
      };
    }
    const dominated = designs.some((other, otherIdx) => {
      if (otherIdx === idx || !other.feasible) {
        return false;
      }
      return dominatesDesign(other, design);
    });
    return {
      ...design,
      isParetoOptimal: !dominated,
    };
  });
}

function parseNumericRequestValue(value, fallback, minValue, maxValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (Number.isFinite(minValue) && Number.isFinite(maxValue)) {
    return clamp(parsed, minValue, maxValue);
  }
  return parsed;
}

function listRecentSimulationRecords(limit = PARETO_DEFAULT_LIMIT_RUNS) {
  return [...simulationStore.values()]
    .filter((record) => ['completed', 'degraded', 'failed'].includes(record?.status))
    .sort((a, b) => {
      const aDate = new Date(a.completed_at || a.started_at || 0).getTime();
      const bDate = new Date(b.completed_at || b.started_at || 0).getTime();
      return bDate - aDate;
    })
    .slice(0, limit);
}

function buildCandidateSeed(record) {
  const geometry = normalizeGeometry(record?.geometry || {});
  const bestMetrics = extractAerodynamicMetrics(record, 'optimized');
  if (!bestMetrics) {
    return null;
  }

  return {
    simulation_id: record.simulation_id,
    status: record.status,
    geometry,
    metrics: bestMetrics,
    selected_ratio: coerceFiniteNumber(record?.optimization?.optimized_metrics?.selected_ratio, 0),
  };
}

function buildDefaultCandidateSeed() {
  return {
    simulation_id: 'synthetic-seed',
    status: 'synthetic',
    geometry: normalizeGeometry({}),
    metrics: {
      cl: 2.35,
      cd: 0.43,
      cm: -0.09,
      l_over_d: 5.465,
    },
    selected_ratio: 0.2,
  };
}

function createCandidateFromSeed(seed, index, target) {
  const phaseA = Math.sin((index + 1) * 1.37);
  const phaseB = Math.cos((index + 1) * 0.93);
  const phaseC = Math.sin((index + 1) * 0.51);

  const span = clamp(seed.geometry.span * (1 + phaseA * 0.03), 0.8, 2.8);
  const chord = clamp(seed.geometry.chord * (1 + phaseB * 0.04), 0.12, 1.2);
  const twist = clamp(seed.geometry.twist + phaseC * 1.2, -8.0, 8.0);
  const sweep = clamp(seed.geometry.sweep + phaseA * 1.5, -2.0, 24.0);
  const taperRatio = clamp(seed.geometry.taper_ratio + phaseB * 0.05, 0.3, 1.1);

  const clBase = seed.metrics.cl + phaseA * 0.18;
  const cdBase = Math.max(seed.metrics.cd * (1 + phaseB * 0.06), 0.04);
  const cmBase = seed.metrics.cm + phaseC * 0.012;

  const cl = clamp(clBase + 0.42 * (target.cl - clBase), 0.2, 4.8);
  const cd = clamp(cdBase + 0.42 * (target.cd - cdBase), 0.03, 1.4);
  const cm = clamp(cmBase + 0.36 * (target.cm - cmBase), -1.5, 1.5);
  const lOverD = toFixedNumber(cl / Math.max(cd, 1e-6));

  const camber = clamp(0.02 + Math.abs(twist) * 0.003 + Math.max(cl - 2.0, 0) * 0.01, 0.015, 0.16);
  const thickness = clamp(0.08 + Math.max(0, 0.13 - cd * 0.05), 0.06, 0.24);
  const volume = toFixedNumber(span * chord * thickness * 0.85, 4);

  const clError = Math.abs(cl - target.cl) / Math.max(Math.abs(target.cl), 1e-6);
  const cdError = Math.abs(cd - target.cd) / Math.max(Math.abs(target.cd), 1e-6);
  const cmError = Math.abs(cm - target.cm) / Math.max(Math.abs(target.cm), 1e-6);
  const targetLOverD = target.cl / Math.max(target.cd, 1e-6);
  const lOverDError = Math.abs(lOverD - targetLOverD) / Math.max(Math.abs(targetLOverD), 1e-6);
  const qualityScore = clamp(
    1 - (0.4 * clError + 0.35 * cdError + 0.15 * cmError + 0.1 * lOverDError),
    0.02,
    0.99
  );

  const targetMet = cl >= target.cl * 0.97 && cd <= target.cd * 1.03 && Math.abs(cm - target.cm) <= 0.06;
  const generationTime = 0.6 + (index % 7) * 0.17 + Math.abs(phaseA) * 0.2;
  const zResolution = clamp(Math.round(48 + span * 16 + Math.abs(twist) * 1.5), 48, 128);

  return {
    id: `${seed.simulation_id}-${index + 1}`,
    candidate_id: index + 1,
    seed_simulation_id: seed.simulation_id,
    quality_score: toFixedNumber(qualityScore, 4),
    target_met: targetMet,
    generation_time_s: toFixedNumber(generationTime, 3),
    shape: [64, 64, zResolution],
    parameters: {
      cl: toFixedNumber(cl),
      cd: toFixedNumber(cd),
      cm: toFixedNumber(cm),
      camber: toFixedNumber(camber, 4),
      thickness: toFixedNumber(thickness, 4),
      span: toFixedNumber(span, 4),
      chord: toFixedNumber(chord, 4),
      twist: toFixedNumber(twist, 4),
      sweep: toFixedNumber(sweep, 4),
      taper_ratio: toFixedNumber(taperRatio, 4),
      volume,
      l_over_d: lOverD,
    },
  };
}

async function persistSimulation(record) {
  simulationStore.set(record.simulation_id, record);

  while (simulationStore.size > MAX_STORED_SIMULATIONS) {
    const firstKey = simulationStore.keys().next().value;
    simulationStore.delete(firstKey);
  }

  try {
    await cache.set(`simulation:${record.simulation_id}`, record, SIMULATION_CACHE_TTL_SECONDS);
  } catch (cacheError) {
    logger.debug(`Simulation cache set skipped for ${record.simulation_id}: ${cacheError.message}`);
  }
}

async function getSimulationRecord(simulationId) {
  const fromMemory = simulationStore.get(simulationId);
  if (fromMemory) {
    return fromMemory;
  }

  try {
    const cached = await cache.get(`simulation:${simulationId}`);
    if (cached) {
      simulationStore.set(simulationId, cached);
      return cached;
    }
  } catch (cacheError) {
    logger.debug(`Simulation cache get skipped for ${simulationId}: ${cacheError.message}`);
  }

  return null;
}

async function runCoupledSimulation(config) {
  const {
    simulationId,
    geometry,
    conditions,
    optimizationEnabled,
    useQuantum,
    useMlSurrogate,
    useCfdAdapter,
    optimizationWeights,
    couplingIterations,
  } = config;

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  const workflow = {
    physics: 'running',
    ml: 'pending',
    quantum: optimizationEnabled ? 'pending' : 'skipped',
    cfd_proxy: 'pending',
  };
  const timelineState = createEmptyTimelineState(workflow, startedAtIso);

  const baseRecord = {
    simulation_id: simulationId,
    status: 'running',
    progress: 5,
    started_at: startedAtIso,
    geometry,
    conditions,
    workflow,
    coupling_iterations: couplingIterations,
    workflow_timeline: toTimelinePayload(timelineState),
  };

  await persistSimulation(baseRecord);

  try {
    const physicsPayload = {
      geometry,
      velocity: conditions.velocity,
      alpha: conditions.alpha,
      yaw: conditions.yaw,
      rho: conditions.rho,
      n_panels_x: conditions.n_panels_x,
      n_panels_y: conditions.n_panels_y,
    };

    const physicsResponse = await retryRequest(
      () => physicsClient.post(physicsConfig.endpoints.vlmSolve, physicsPayload),
      2,
      400
    );
    const vlmResult = physicsResponse.data;
    workflow.physics = 'completed';
    updateTimelineStage(timelineState, 'physics', 'completed');
    updateTimelineStage(timelineState, 'ml', 'running');

    await persistSimulation({
      ...baseRecord,
      workflow,
      progress: 30,
      workflow_timeline: toTimelinePayload(timelineState),
    });

    let mlResult;
    let mlSource = 'service';
    if (useMlSurrogate) {
      try {
        const mlResponse = await mlClient.post(mlConfig.endpoints.predict, {
          mesh_id: `mesh_${simulationId}`,
          parameters: {
            velocity: conditions.velocity,
            alpha: conditions.alpha,
            yaw: conditions.yaw,
            rho: conditions.rho,
          },
          use_cache: true,
          return_confidence: true,
        });
        mlResult = mlResponse.data;
        workflow.ml = 'completed';
        updateTimelineStage(timelineState, 'ml', 'completed', new Date(), {
          source: 'service',
        });
      } catch (mlError) {
        logger.warn(`ML surrogate unavailable, using fallback for ${simulationId}: ${mlError.message}`);
        mlResult = buildMlFallback(vlmResult, conditions);
        mlSource = 'fallback';
        workflow.ml = 'degraded';
        updateTimelineStage(timelineState, 'ml', 'degraded', new Date(), {
          source: 'fallback',
          message: mlError.message,
        });
      }
    } else {
      mlResult = buildMlFallback(vlmResult, conditions);
      mlSource = 'disabled';
      workflow.ml = 'skipped';
      updateTimelineStage(timelineState, 'ml', 'skipped', new Date(), {
        source: 'disabled',
      });
    }
    updateTimelineStage(timelineState, 'cfd_proxy', 'running');

    const cfdRuns = [];
    const baselineCfd = await evaluateCfdMetrics({
      simulationId,
      stage: 'baseline',
      iteration: 0,
      useCfdAdapter,
      vlmResult,
      mlResult,
      conditions,
      targetMetrics: {
        cl: vlmResult.cl,
        cd: vlmResult.cd,
        cm: vlmResult.cm,
      },
      selectedRatio: 0,
    });
    const cfdProxyBaseline = baselineCfd.metrics;
    workflow.cfd_proxy = baselineCfd.degraded ? 'degraded' : 'completed';

    cfdRuns.push({
      stage: 'baseline',
      iteration: 0,
      cfd_job_id: baselineCfd.cfd_job_id,
      cfd_engine: baselineCfd.cfd_engine,
      cfd_solver: baselineCfd.cfd_solver,
      residual_l2: baselineCfd.residual_l2,
      degraded: baselineCfd.degraded,
    });
    updateTimelineStage(timelineState, 'cfd_proxy', 'running', new Date(), {
      baseline_run_complete: true,
      baseline_degraded: baselineCfd.degraded,
      run_count: cfdRuns.length,
    });

    await persistSimulation({
      ...baseRecord,
      workflow,
      progress: optimizationEnabled ? 45 : 90,
      workflow_timeline: toTimelinePayload(timelineState),
      baseline: {
        cfd_proxy: cfdProxyBaseline,
      },
      cfd: {
        engine: baselineCfd.cfd_engine,
        runs: cfdRuns,
      },
    });

    let quantumResult = null;
    let optimizedMetrics = null;
    let cfdProxyOptimized = null;
    let currentNodes = Array.isArray(vlmResult.lattice_nodes) ? [...vlmResult.lattice_nodes] : [];
    let currentMetrics = {
      cl: cfdProxyBaseline.cl,
      cd: cfdProxyBaseline.cd,
      cm: cfdProxyBaseline.cm,
      l_over_d: cfdProxyBaseline.l_over_d,
    };
    const couplingHistory = [];

    if (optimizationEnabled && currentNodes.length > 0) {
      updateTimelineStage(timelineState, 'quantum', 'running', new Date(), {
        iterations_target: couplingIterations,
      });
      for (let iterationIndex = 0; iterationIndex < couplingIterations; iterationIndex += 1) {
        const { quboMatrix, activeNodes } = buildNodeQubo(currentNodes, {
          dragWeight: optimizationWeights.drag,
          liftWeight: optimizationWeights.lift,
          maxNodes: optimizationWeights.max_nodes,
        });

        if (quboMatrix.length === 0) {
          workflow.quantum = 'skipped';
          updateTimelineStage(timelineState, 'quantum', 'skipped', new Date(), {
            reason: 'empty_qubo',
          });
          break;
        }

        try {
          const optimizationResponse = await quantumClient.post(
            quantumConfig.endpoints.qubo,
            {
              qubo_matrix: quboMatrix,
              method: useQuantum ? 'auto' : 'classical',
            }
          );

          const rawQuantum = optimizationResponse.data;
          const selectedIndices = (rawQuantum.solution || [])
            .map((value, idx) => ({ value, idx }))
            .filter((entry) => Number(entry.value) === 1)
            .map((entry) => entry.idx);

          const selectedNodes = selectedIndices
            .map((idx) => activeNodes[idx])
            .filter(Boolean);

          const iterationOptimized = applyNodeOptimization(
            {
              cl: currentMetrics.cl,
              cd: currentMetrics.cd,
              cm: currentMetrics.cm,
            },
            selectedNodes,
            activeNodes.length
          );

          const iterationCfdEvaluation = await evaluateCfdMetrics({
            simulationId,
            stage: 'coupling',
            iteration: iterationIndex + 1,
            useCfdAdapter,
            vlmResult,
            mlResult,
            conditions,
            targetMetrics: {
              cl: iterationOptimized.cl,
              cd: iterationOptimized.cd,
              cm: iterationOptimized.cm,
            },
            selectedRatio: activeNodes.length > 0 ? selectedNodes.length / activeNodes.length : 0,
          });
          const iterationCfd = iterationCfdEvaluation.metrics;

          couplingHistory.push({
            iteration: iterationIndex + 1,
            quantum_method: rawQuantum.method || (useQuantum ? 'auto' : 'classical'),
            cost: rawQuantum.cost,
            selected_nodes: selectedNodes.length,
            selected_ratio: activeNodes.length > 0 ? selectedNodes.length / activeNodes.length : 0,
            cl: iterationCfd.cl,
            cd: iterationCfd.cd,
            l_over_d: iterationCfd.l_over_d,
            quantum_time_ms: rawQuantum.computation_time_ms,
            cfd_job_id: iterationCfdEvaluation.cfd_job_id,
            cfd_engine: iterationCfdEvaluation.cfd_engine,
            cfd_solver: iterationCfdEvaluation.cfd_solver,
            residual_l2: iterationCfdEvaluation.residual_l2,
          });

          cfdRuns.push({
            stage: 'coupling',
            iteration: iterationIndex + 1,
            cfd_job_id: iterationCfdEvaluation.cfd_job_id,
            cfd_engine: iterationCfdEvaluation.cfd_engine,
            cfd_solver: iterationCfdEvaluation.cfd_solver,
            residual_l2: iterationCfdEvaluation.residual_l2,
            degraded: iterationCfdEvaluation.degraded,
          });
          if (iterationCfdEvaluation.degraded) {
            workflow.cfd_proxy = 'degraded';
          }

          currentMetrics = {
            cl: iterationCfd.cl,
            cd: iterationCfd.cd,
            cm: iterationCfd.cm,
            l_over_d: iterationCfd.l_over_d,
          };

          currentNodes = mutateNodesForNextIteration(
            currentNodes,
            selectedNodes.map((node) => node.node_id),
            iterationIndex,
            couplingIterations
          );

          quantumResult = {
            method: rawQuantum.method || (useQuantum ? 'auto' : 'classical'),
            cost: rawQuantum.cost,
            iterations: rawQuantum.iterations,
            computation_time_ms: rawQuantum.computation_time_ms,
            success: rawQuantum.success,
            active_node_count: selectedNodes.length,
            active_nodes: selectedNodes.map((node) => ({
              node_id: node.node_id,
              position: node.position,
              lift: node.lift,
              drag: node.drag,
              cp: node.cp,
            })),
            solution_vector: rawQuantum.solution || [],
          };

          optimizedMetrics = {
            cl: iterationCfd.cl,
            cd: iterationCfd.cd,
            cm: iterationCfd.cm,
            l_over_d: iterationCfd.l_over_d,
            selected_ratio: iterationOptimized.selected_ratio,
            selected_nodes: iterationOptimized.selected_nodes,
          };

          cfdProxyOptimized = iterationCfd;
          workflow.quantum = 'completed';

          const progress = clamp(Math.round(50 + ((iterationIndex + 1) / couplingIterations) * 40), 50, 94);
          await persistSimulation({
            ...baseRecord,
            workflow,
            progress,
            workflow_timeline: toTimelinePayload(timelineState),
            baseline: {
              cfd_proxy: cfdProxyBaseline,
            },
            cfd: {
              engine: cfdRuns[cfdRuns.length - 1]?.cfd_engine || baselineCfd.cfd_engine,
              runs: cfdRuns,
            },
            optimization: {
              enabled: true,
              coupling_history: couplingHistory,
              latest_iteration: couplingHistory[couplingHistory.length - 1],
            },
          });
        } catch (quantumError) {
          logger.warn(`Quantum optimization unavailable for ${simulationId}: ${quantumError.message}`);
          workflow.quantum = 'degraded';
          updateTimelineStage(timelineState, 'quantum', 'degraded', new Date(), {
            message: quantumError.message,
            completed_iterations: couplingHistory.length,
          });
          break;
        }
      }
    } else if (optimizationEnabled) {
      workflow.quantum = 'skipped';
      updateTimelineStage(timelineState, 'quantum', 'skipped', new Date(), {
        reason: 'no_nodes',
      });
    }

    if (!optimizationEnabled) {
      updateTimelineStage(timelineState, 'quantum', 'skipped', new Date(), {
        reason: 'optimization_disabled',
      });
    } else if (workflow.quantum === 'completed') {
      updateTimelineStage(timelineState, 'quantum', 'completed', new Date(), {
        completed_iterations: couplingHistory.length,
      });
    } else if (workflow.quantum === 'pending') {
      updateTimelineStage(timelineState, 'quantum', 'skipped', new Date(), {
        reason: 'no_solution',
      });
    }

    updateTimelineStage(
      timelineState,
      'cfd_proxy',
      workflow.cfd_proxy === 'pending' ? 'skipped' : workflow.cfd_proxy,
      new Date(),
      {
        run_count: cfdRuns.length,
      }
    );
    updateTimelineStage(timelineState, 'analysis', 'running');
    const nodeAnalytics = buildNodeAnalytics(
      currentNodes,
      (quantumResult?.active_nodes || []).map((node) => node.node_id)
    );
    updateTimelineStage(timelineState, 'analysis', 'completed', new Date(), {
      node_count: currentNodes.length,
      selected_nodes: nodeAnalytics.selected_nodes,
    });
    updateTimelineStage(timelineState, 'report', 'running');

    const simulationStatus = summarizeWorkflow(workflow);
    const completedAt = new Date();
    updateTimelineStage(timelineState, 'report', 'completed', completedAt, {
      status: simulationStatus,
      coupling_iterations: couplingHistory.length,
    });
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const data = {
      simulation_id: simulationId,
      status: simulationStatus,
      workflow,
      progress: 100,
      coupling_iterations: couplingIterations,
      workflow_timeline: toTimelinePayload(timelineState),
      baseline: {
        vlm: {
          cl: vlmResult.cl,
          cd: vlmResult.cd,
          cm: vlmResult.cm,
          l_over_d: vlmResult.l_over_d,
          lift: vlmResult.lift,
          drag: vlmResult.drag,
          side_force: vlmResult.side_force,
          moment: vlmResult.moment,
        },
        ml_surrogate: {
          ...mlResult,
          source: mlSource,
        },
        cfd_proxy: cfdProxyBaseline,
      },
      optimization: optimizedMetrics
        ? {
            enabled: true,
            use_quantum: useQuantum,
            quantum: quantumResult,
            optimized_metrics: optimizedMetrics,
            cfd_proxy_optimized: cfdProxyOptimized,
            coupling_history: couplingHistory,
            improvement: {
              cl_delta: toFixedNumber(optimizedMetrics.cl - cfdProxyBaseline.cl),
              cd_delta: toFixedNumber(optimizedMetrics.cd - cfdProxyBaseline.cd),
              l_over_d_delta: toFixedNumber(optimizedMetrics.l_over_d - cfdProxyBaseline.l_over_d),
            },
          }
        : {
            enabled: optimizationEnabled,
            use_quantum: useQuantum,
            quantum: quantumResult,
            coupling_history: couplingHistory,
          },
      cfd: {
        adapter_enabled: useCfdAdapter,
        engine: cfdRuns[cfdRuns.length - 1]?.cfd_engine || (useCfdAdapter ? cfdAdapter.engineName : 'proxy'),
        runs: cfdRuns,
      },
      visualizations: {
        vlm_nodes: currentNodes,
        circulation: vlmResult.gamma || [],
        pressure: vlmResult.pressure || [],
        node_analytics: nodeAnalytics,
      },
      timings: {
        total_time_ms: durationMs,
      },
      started_at: startedAtIso,
      completed_at: completedAt.toISOString(),
    };

    await persistSimulation(data);

    return data;
  } catch (error) {
    const failedAt = new Date();
    const activeStage = WORKFLOW_TIMELINE_STAGES.find(
      (stage) => timelineState?.[stage.id]?.status === 'running'
    );
    if (activeStage) {
      updateTimelineStage(timelineState, activeStage.id, 'failed', failedAt, {
        message: error.message,
      });
    }
    if (timelineState?.analysis?.status === 'pending') {
      updateTimelineStage(timelineState, 'analysis', 'skipped', failedAt, {
        reason: 'workflow_failed',
      });
    }
    if (timelineState?.report?.status === 'pending') {
      updateTimelineStage(timelineState, 'report', 'skipped', failedAt, {
        reason: 'workflow_failed',
      });
    }

    const failedRecord = {
      ...baseRecord,
      status: 'failed',
      workflow: {
        ...workflow,
        cfd_proxy: workflow.cfd_proxy === 'pending' ? 'failed' : workflow.cfd_proxy,
      },
      progress: 100,
      workflow_timeline: toTimelinePayload(timelineState),
      error: error.message,
      failed_at: failedAt.toISOString(),
    };

    await persistSimulation(failedRecord);
    throw error;
  }
}

/**
 * POST /api/simulation/run
 * Run complete aerodynamic simulation
 * Orchestrates: Physics -> ML -> Quantum -> CFD-proxy coupling
 */
router.post('/run', async (req, res, next) => {
  try {
    const geometry = normalizeGeometry(req.body.geometry);
    const conditions = normalizeConditions(req.body.conditions);
    const optimizationEnabled = Boolean(req.body.optimization);
    const useQuantum = req.body.use_quantum !== false;
    const useMlSurrogate = req.body.use_ml_surrogate !== false;
    const useCfdAdapter = req.body.use_cfd_adapter !== false;
    const optimizationWeights = req.body.optimization_weights || {};
    const couplingIterations = normalizeCouplingIterations(
      req.body.coupling_iterations ?? req.body.n_iterations,
      4
    );
    const asyncMode = req.body.async_mode === true;
    const simulationId = `sim_${randomUUID()}`;

    logger.info(`Full simulation request received: ${simulationId}`);

    const runConfig = {
      simulationId,
      geometry,
      conditions,
      optimizationEnabled,
      useQuantum,
      useMlSurrogate,
      useCfdAdapter,
      optimizationWeights,
      couplingIterations,
    };

    if (asyncMode) {
      const runningRecord = {
        simulation_id: simulationId,
        status: 'running',
        progress: 0,
        geometry,
        conditions,
        use_cfd_adapter: useCfdAdapter,
        coupling_iterations: couplingIterations,
        started_at: new Date().toISOString(),
      };
      await persistSimulation(runningRecord);

      const jobPromise = runCoupledSimulation(runConfig)
        .catch((error) => {
          logger.error(`Async simulation failed (${simulationId}): ${error.message}`);
        })
        .finally(() => {
          activeSimulationJobs.delete(simulationId);
        });

      activeSimulationJobs.set(simulationId, jobPromise);

      return res.status(202).json({
        success: true,
        data: {
          simulation_id: simulationId,
          status: 'running',
          mode: 'async',
          poll_url: `/api/simulation/${simulationId}`,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const data = await runCoupledSimulation(runConfig);

    return res.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/simulation
 * List recent simulations
 */
router.get('/', async (req, res, next) => {
  try {
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 100);
    const includeFailed = req.query.include_failed !== 'false';

    let simulations = [...simulationStore.values()]
      .sort((a, b) => {
        const aDate = new Date(a.completed_at || a.started_at || 0).getTime();
        const bDate = new Date(b.completed_at || b.started_at || 0).getTime();
        return bDate - aDate;
      });

    if (!includeFailed) {
      simulations = simulations.filter((simulation) => simulation.status !== 'failed');
    }

    simulations = simulations.slice(0, limit).map((simulation) => ({
      simulation_id: simulation.simulation_id,
      status: simulation.status,
      progress: simulation.progress ?? (simulation.status === 'completed' ? 100 : 0),
      started_at: simulation.started_at,
      completed_at: simulation.completed_at,
      coupling_iterations: simulation.coupling_iterations,
      workflow: simulation.workflow,
    }));

    return res.json({
      success: true,
      data: {
        count: simulations.length,
        active_jobs: activeSimulationJobs.size,
        simulations,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/simulation/pareto
 * Build Pareto tradeoff dataset from recent simulation results.
 */
router.get('/pareto', async (req, res, next) => {
  try {
    const limitRuns = Math.round(parseNumericRequestValue(
      req.query.limit_runs,
      PARETO_DEFAULT_LIMIT_RUNS,
      1,
      MAX_STORED_SIMULATIONS
    ));
    const maxPoints = Math.round(parseNumericRequestValue(
      req.query.max_points,
      120,
      4,
      PARETO_MAX_POINTS
    ));

    const records = listRecentSimulationRecords(limitRuns);
    const rawDesigns = [];
    records.forEach((record, idx) => {
      const baselinePoint = buildParetoDesignPoint(
        record,
        extractAerodynamicMetrics(record, 'baseline'),
        'baseline',
        idx
      );
      if (baselinePoint) {
        rawDesigns.push(baselinePoint);
      }

      const optimizedPoint = buildParetoDesignPoint(
        record,
        extractAerodynamicMetrics(record, 'optimized'),
        'optimized',
        idx
      );
      if (optimizedPoint) {
        rawDesigns.push(optimizedPoint);
      }
    });

    const limitedDesigns = rawDesigns.slice(0, maxPoints);
    const designs = annotateParetoFrontier(limitedDesigns);
    const feasibleCount = designs.filter((design) => design.feasible).length;
    const paretoCount = designs.filter((design) => design.feasible && design.isParetoOptimal).length;

    return res.json({
      success: true,
      data: {
        designs,
        summary: {
          simulations_used: records.length,
          total_designs: designs.length,
          feasible_designs: feasibleCount,
          infeasible_designs: Math.max(designs.length - feasibleCount, 0),
          pareto_optimal: paretoCount,
        },
        objectives: [
          { key: 'drag', direction: 'minimize' },
          { key: 'downforce', direction: 'maximize' },
          { key: 'flutter_margin', direction: 'maximize' },
          { key: 'mass', direction: 'minimize' },
          { key: 'L_D', direction: 'maximize' },
        ],
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/simulation/candidates/generate
 * Generate geometry candidates from recent simulation outputs.
 */
router.post('/candidates/generate', async (req, res, next) => {
  try {
    const numCandidates = Math.round(parseNumericRequestValue(
      req.body.num_candidates,
      CANDIDATE_DEFAULT_COUNT,
      1,
      CANDIDATE_MAX_COUNT
    ));
    const target = {
      cl: parseNumericRequestValue(req.body.target_cl, 2.8, 0.1, 6.0),
      cd: parseNumericRequestValue(req.body.target_cd, 0.4, 0.02, 2.0),
      cm: parseNumericRequestValue(req.body.target_cm, -0.1, -2.0, 2.0),
    };

    const seedLimit = Math.round(parseNumericRequestValue(req.body.seed_limit, 25, 1, 100));
    const records = listRecentSimulationRecords(seedLimit);
    const seedPool = records
      .map((record) => buildCandidateSeed(record))
      .filter(Boolean);

    const activeSeedPool = seedPool.length > 0 ? seedPool : [buildDefaultCandidateSeed()];
    const generated = Array.from({ length: numCandidates }, (_, idx) => {
      const seed = activeSeedPool[idx % activeSeedPool.length];
      return createCandidateFromSeed(seed, idx, target);
    });

    const candidates = generated
      .sort((a, b) => b.quality_score - a.quality_score)
      .map((candidate, idx) => ({
        ...candidate,
        rank: idx + 1,
      }));

    return res.json({
      success: true,
      data: {
        num_generated: candidates.length,
        seed_count: activeSeedPool.length,
        target_cl: target.cl,
        target_cd: target.cd,
        target_cm: target.cm,
        candidates,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/simulation/cfd/jobs/:jobId
 * Query CFD adapter job state directly
 */
router.get('/cfd/jobs/:jobId', async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const status = await cfdAdapter.getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: {
          job_id: jobId,
          message: 'CFD job not found',
        },
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/simulation/:id/timeline
 * Return explicit stage timeline with measured durations.
 */
router.get('/:id/timeline', async (req, res, next) => {
  try {
    const { id } = req.params;
    const record = await getSimulationRecord(id);
    if (!record) {
      return res.status(404).json({
        success: false,
        error: {
          simulation_id: id,
          status: 'not_found',
          message: 'Simulation result not found',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const stages = getTimelineStages(record);
    const totalDurationS = stages
      .filter((stage) => Number.isFinite(stage.duration_s))
      .reduce((sum, stage) => sum + stage.duration_s, 0);

    return res.json({
      success: true,
      data: {
        simulation_id: record.simulation_id,
        status: record.status,
        started_at: record.started_at || null,
        completed_at: record.completed_at || null,
        total_duration_s: toFixedNumber(totalDurationS, 3),
        stages,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/simulation/:id
 * Get simulation results by ID
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    logger.info(`Simulation result request: ${id}`);

    const record = await getSimulationRecord(id);
    if (!record) {
      return res.status(404).json({
        success: false,
        error: {
          simulation_id: id,
          status: 'not_found',
          message: 'Simulation result not found',
        },
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: record,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
