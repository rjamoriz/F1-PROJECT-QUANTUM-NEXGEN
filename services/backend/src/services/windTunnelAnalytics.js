const WIND_TUNNEL_CONTRACT_VERSION = 'phase-a-v1';

const DEFAULT_TUNNEL = Object.freeze({
  length_m: 16,
  width_m: 7,
  height_m: 5,
  moving_ground: true,
  turbulence_intensity: 0.015,
});

const DEFAULT_SIMULATION = Object.freeze({
  optimization: true,
  use_quantum: true,
  use_ml_surrogate: true,
  use_cfd_adapter: true,
  coupling_iterations: 4,
  optimization_weights: {
    drag: 1.0,
    lift: 1.0,
    max_nodes: 24,
  },
});

const SCENARIOS = Object.freeze([
  {
    id: 'front_wing_high_downforce',
    name: 'Front Wing High Downforce',
    description: 'Focuses on front wing + endplate loading under high yaw sensitivity.',
    focus_surfaces: ['front_wing', 'endplate', 'nose'],
    default_geometry: {
      span: 1.25,
      chord: 0.32,
      twist: -1.4,
      dihedral: 0.3,
      sweep: 8.0,
      taper_ratio: 0.72,
    },
    default_conditions: {
      velocity: 74,
      alpha: 4.8,
      yaw: 0.8,
      rho: 1.225,
      n_panels_x: 22,
      n_panels_y: 12,
    },
  },
  {
    id: 'floor_ground_effect_balance',
    name: 'Floor Ground-Effect Balance',
    description: 'Explores floor-edge and diffuser balance for drag/downforce trade-off.',
    focus_surfaces: ['floor', 'floor_edge', 'diffuser'],
    default_geometry: {
      span: 1.5,
      chord: 0.34,
      twist: -0.8,
      dihedral: 0.0,
      sweep: 5.5,
      taper_ratio: 0.82,
    },
    default_conditions: {
      velocity: 78,
      alpha: 3.7,
      yaw: 0.2,
      rho: 1.225,
      n_panels_x: 24,
      n_panels_y: 14,
    },
  },
  {
    id: 'rear_wing_low_drag_trim',
    name: 'Rear Wing Low Drag Trim',
    description: 'Targets rear wing efficiency while limiting drag growth at race pace.',
    focus_surfaces: ['rear_wing', 'beam_wing'],
    default_geometry: {
      span: 1.15,
      chord: 0.27,
      twist: -0.5,
      dihedral: 0.1,
      sweep: 11.0,
      taper_ratio: 0.68,
    },
    default_conditions: {
      velocity: 82,
      alpha: 3.9,
      yaw: 0.4,
      rho: 1.225,
      n_panels_x: 20,
      n_panels_y: 10,
    },
  },
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toSafeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toFixedNumber(value, decimals = 6) {
  return Number(Number(value).toFixed(decimals));
}

function pickScenarioById(scenarioId) {
  const normalizedId = String(scenarioId || '').trim();
  return SCENARIOS.find((scenario) => scenario.id === normalizedId) || SCENARIOS[0];
}

function normalizeGeometry(input = {}, scenario) {
  const defaults = scenario.default_geometry;
  return {
    span: toSafeNumber(input.span, defaults.span),
    chord: toSafeNumber(input.chord, defaults.chord),
    twist: toSafeNumber(input.twist, defaults.twist),
    dihedral: toSafeNumber(input.dihedral, defaults.dihedral),
    sweep: toSafeNumber(input.sweep, defaults.sweep),
    taper_ratio: toSafeNumber(input.taper_ratio, defaults.taper_ratio),
  };
}

function normalizeConditions(input = {}, scenario) {
  const defaults = scenario.default_conditions;
  return {
    velocity: toSafeNumber(input.velocity, defaults.velocity),
    alpha: toSafeNumber(input.alpha, defaults.alpha),
    yaw: toSafeNumber(input.yaw, defaults.yaw),
    rho: toSafeNumber(input.rho, defaults.rho),
    n_panels_x: clamp(Math.round(toSafeNumber(input.n_panels_x, defaults.n_panels_x)), 5, 40),
    n_panels_y: clamp(Math.round(toSafeNumber(input.n_panels_y, defaults.n_panels_y)), 5, 30),
  };
}

function normalizeTunnel(input = {}) {
  return {
    length_m: toSafeNumber(input.length_m, DEFAULT_TUNNEL.length_m),
    width_m: toSafeNumber(input.width_m, DEFAULT_TUNNEL.width_m),
    height_m: toSafeNumber(input.height_m, DEFAULT_TUNNEL.height_m),
    moving_ground: input.moving_ground !== false,
    turbulence_intensity: clamp(toSafeNumber(input.turbulence_intensity, DEFAULT_TUNNEL.turbulence_intensity), 0.001, 0.2),
  };
}

function normalizeSimulation(input = {}) {
  const optimizationWeights = input.optimization_weights && typeof input.optimization_weights === 'object'
    ? input.optimization_weights
    : {};

  return {
    optimization: input.optimization !== false,
    use_quantum: input.use_quantum !== false,
    use_ml_surrogate: input.use_ml_surrogate !== false,
    use_cfd_adapter: input.use_cfd_adapter !== false,
    coupling_iterations: clamp(
      Math.round(toSafeNumber(input.coupling_iterations, DEFAULT_SIMULATION.coupling_iterations)),
      1,
      20
    ),
    optimization_weights: {
      drag: toSafeNumber(optimizationWeights.drag, DEFAULT_SIMULATION.optimization_weights.drag),
      lift: toSafeNumber(optimizationWeights.lift, DEFAULT_SIMULATION.optimization_weights.lift),
      max_nodes: clamp(
        Math.round(toSafeNumber(optimizationWeights.max_nodes, DEFAULT_SIMULATION.optimization_weights.max_nodes)),
        4,
        40
      ),
    },
  };
}

function normalizeWindTunnelRequest(payload = {}) {
  const scenario = pickScenarioById(payload.scenario_id || payload.scenario?.id);
  return {
    scenario: {
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      focus_surfaces: [...scenario.focus_surfaces],
    },
    geometry: normalizeGeometry(payload.geometry || {}, scenario),
    conditions: normalizeConditions(payload.conditions || {}, scenario),
    tunnel: normalizeTunnel(payload.tunnel || {}),
    simulation: normalizeSimulation(payload.simulation || payload),
  };
}

function getWindTunnelConfigContract() {
  const firstScenario = SCENARIOS[0];
  return {
    contract_version: WIND_TUNNEL_CONTRACT_VERSION,
    scenarios: clone(SCENARIOS).map((scenario) => ({
      ...scenario,
      recommended: scenario.id === firstScenario.id,
    })),
    default_request: {
      scenario_id: firstScenario.id,
      geometry: clone(firstScenario.default_geometry),
      conditions: clone(firstScenario.default_conditions),
      tunnel: clone(DEFAULT_TUNNEL),
      simulation: clone(DEFAULT_SIMULATION),
    },
    response_contract: {
      required_fields: [
        'wind_tunnel_session_id',
        'contract_version',
        'scenario',
        'flow_field',
        'coupled_results',
        'references',
      ],
      flow_field_fields: ['vectors', 'streamlines', 'vortexCores', 'pressureData', 'statistics', 'counts'],
      coupled_result_fields: ['simulation_id', 'status', 'summary', 'node_hotspots', 'workflow', 'workflow_timeline'],
    },
  };
}

function buildWindTunnelFlowFallback({ meshId, conditions = {} }) {
  const velocity = clamp(toSafeNumber(conditions.velocity, 72), 5, 220);
  const alpha = clamp(toSafeNumber(conditions.alpha, 4.5), -20, 20);
  const yaw = clamp(toSafeNumber(conditions.yaw, 0), -10, 10);
  const alphaRad = (alpha * Math.PI) / 180;
  const yawRad = (yaw * Math.PI) / 180;
  const velocityScale = velocity / 72;

  const vectors = [];
  const pressureData = [];

  for (let i = 0; i < 9; i += 1) {
    for (let j = 0; j < 11; j += 1) {
      for (let k = 0; k < 4; k += 1) {
        const x = (i - 4) * 0.24;
        const y = k * 0.1;
        const z = (j - 5) * 0.11;
        const radial = Math.sqrt(x * x + z * z) + 1e-6;
        const lateralBias = Math.sin(z * 2.1 + yawRad) * 0.06;

        const vx = (0.95 + 0.16 * Math.cos(radial + alphaRad)) * velocityScale;
        const vy = 0.08 * Math.sin(radial * 2.0 + alphaRad);
        const vz = 0.03 + lateralBias;

        vectors.push({
          position: [toFixedNumber(x, 5), toFixedNumber(y, 5), toFixedNumber(z, 5)],
          velocity: [toFixedNumber(vx, 5), toFixedNumber(vy, 5), toFixedNumber(vz, 5)],
        });

        const pressure = -0.5 * (vx * vx + vy * vy + vz * vz);
        pressureData.push({
          position: [toFixedNumber(x, 5), toFixedNumber(y, 5), toFixedNumber(z, 5)],
          value: toFixedNumber(pressure, 6),
        });
      }
    }
  }

  const streamlines = Array.from({ length: 7 }, (_, idx) => {
    const y = (idx - 3) * 0.16;
    return {
      points: Array.from({ length: 56 }, (_, step) => {
        const x = -1.2 + step * 0.05;
        const z = 0.08 * Math.sin((x + y) * 2.4 + alphaRad) + 0.03 * Math.sin(yawRad + x * 0.8);
        return [toFixedNumber(y, 5), toFixedNumber(z, 5), toFixedNumber(x, 5)];
      }),
    };
  });

  const vortexCores = [
    {
      position: [0.0, 0.07, 0.15],
      radius: 0.082,
      strength: toFixedNumber(1.35 + Math.abs(alphaRad) * 0.6 + Math.abs(yawRad) * 0.3, 5),
    },
    {
      position: [0.0, 0.05, 0.68],
      radius: 0.058,
      strength: toFixedNumber(0.82 + Math.abs(alphaRad) * 0.2 + Math.abs(yawRad) * 0.15, 5),
    },
  ];

  const magnitudes = vectors.map((vector) => {
    const [vx, vy, vz] = vector.velocity;
    return Math.sqrt(vx * vx + vy * vy + vz * vz);
  });
  const pressureValues = pressureData.map((point) => point.value);

  return {
    mesh_id: String(meshId || 'wind_tunnel_fallback'),
    vectors,
    streamlines,
    vortexCores,
    pressureData,
    statistics: {
      maxVelocity: toFixedNumber(Math.max(...magnitudes, 0), 5),
      minPressure: toFixedNumber(Math.min(...pressureValues, 0), 6),
      maxVorticity: toFixedNumber(Math.max(...vortexCores.map((core) => core.strength), 0) * 1.8, 5),
      turbulenceIntensity: toFixedNumber(0.12 + Math.min(0.14, Math.abs(alphaRad) * 0.4), 5),
    },
  };
}

function normalizeFlowFieldPayload(payload = {}, context = {}) {
  const vectors = Array.isArray(payload.vectors) ? payload.vectors : [];
  const streamlines = Array.isArray(payload.streamlines) ? payload.streamlines : [];
  const vortexCores = Array.isArray(payload.vortexCores) ? payload.vortexCores : [];
  const pressureData = Array.isArray(payload.pressureData) ? payload.pressureData : [];

  if (vectors.length === 0 || streamlines.length === 0 || pressureData.length === 0) {
    return buildWindTunnelFlowFallback({
      meshId: payload.mesh_id || context.meshId,
      conditions: context.conditions,
    });
  }

  return {
    mesh_id: String(payload.mesh_id || context.meshId || 'wind_tunnel_mesh'),
    vectors,
    streamlines,
    vortexCores,
    pressureData,
    statistics: {
      maxVelocity: toSafeNumber(payload.statistics?.maxVelocity, 0),
      minPressure: toSafeNumber(payload.statistics?.minPressure, 0),
      maxVorticity: toSafeNumber(payload.statistics?.maxVorticity, 0),
      turbulenceIntensity: toSafeNumber(payload.statistics?.turbulenceIntensity, 0),
    },
  };
}

function buildNodeHotspots(nodes = [], selectedNodeIds = []) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return {
      total_nodes: 0,
      selected_nodes: 0,
      selected_ratio: 0,
      top_lift_nodes: [],
      top_drag_nodes: [],
      spanwise_distribution: [],
    };
  }

  const selectedSet = new Set(selectedNodeIds);

  const normalizedNodes = nodes.map((node) => ({
    node_id: Number(node.node_id),
    span_index: Number.isFinite(Number(node.span_index)) ? Number(node.span_index) : 0,
    chord_index: Number.isFinite(Number(node.chord_index)) ? Number(node.chord_index) : 0,
    lift: toSafeNumber(node.lift, 0),
    drag: toSafeNumber(node.drag, 0),
    cp: toSafeNumber(node.cp, 0),
    gamma: toSafeNumber(node.gamma, 0),
    position: Array.isArray(node.position) ? node.position : [0, 0, 0],
  }));

  const topLiftNodes = [...normalizedNodes]
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 12)
    .map((node) => ({
      node_id: node.node_id,
      span_index: node.span_index,
      chord_index: node.chord_index,
      lift: toFixedNumber(node.lift, 6),
      drag: toFixedNumber(node.drag, 6),
      cp: toFixedNumber(node.cp, 6),
      selected: selectedSet.has(node.node_id),
    }));

  const topDragNodes = [...normalizedNodes]
    .sort((a, b) => Math.abs(b.drag) - Math.abs(a.drag))
    .slice(0, 12)
    .map((node) => ({
      node_id: node.node_id,
      span_index: node.span_index,
      chord_index: node.chord_index,
      lift: toFixedNumber(node.lift, 6),
      drag: toFixedNumber(node.drag, 6),
      cp: toFixedNumber(node.cp, 6),
      selected: selectedSet.has(node.node_id),
    }));

  const bySpan = new Map();
  normalizedNodes.forEach((node) => {
    const key = node.span_index;
    if (!bySpan.has(key)) {
      bySpan.set(key, {
        span_index: key,
        nodes: 0,
        selected_nodes: 0,
        lift_sum: 0,
        drag_sum: 0,
      });
    }
    const bucket = bySpan.get(key);
    bucket.nodes += 1;
    bucket.lift_sum += node.lift;
    bucket.drag_sum += Math.abs(node.drag);
    if (selectedSet.has(node.node_id)) {
      bucket.selected_nodes += 1;
    }
  });

  const spanwiseDistribution = [...bySpan.values()]
    .sort((a, b) => a.span_index - b.span_index)
    .map((bucket) => ({
      span_index: bucket.span_index,
      nodes: bucket.nodes,
      selected_nodes: bucket.selected_nodes,
      selected_ratio: bucket.nodes > 0 ? toFixedNumber(bucket.selected_nodes / bucket.nodes, 4) : 0,
      avg_lift: bucket.nodes > 0 ? toFixedNumber(bucket.lift_sum / bucket.nodes, 6) : 0,
      avg_drag: bucket.nodes > 0 ? toFixedNumber(bucket.drag_sum / bucket.nodes, 6) : 0,
    }));

  return {
    total_nodes: normalizedNodes.length,
    selected_nodes: selectedNodeIds.length,
    selected_ratio: normalizedNodes.length > 0
      ? toFixedNumber(selectedNodeIds.length / normalizedNodes.length, 4)
      : 0,
    top_lift_nodes: topLiftNodes,
    top_drag_nodes: topDragNodes,
    spanwise_distribution: spanwiseDistribution,
  };
}

function toSummaryMetrics(metrics = null) {
  if (!metrics || typeof metrics !== 'object') {
    return null;
  }

  const cl = toSafeNumber(metrics.cl, null);
  const cd = toSafeNumber(metrics.cd, null);
  if (!Number.isFinite(cl) || !Number.isFinite(cd) || cd <= 0) {
    return null;
  }

  const cm = toSafeNumber(metrics.cm, 0);
  const lOverD = toSafeNumber(metrics.l_over_d, cl / Math.max(cd, 1e-6));

  return {
    cl: toFixedNumber(cl, 6),
    cd: toFixedNumber(cd, 6),
    cm: toFixedNumber(cm, 6),
    l_over_d: toFixedNumber(lOverD, 6),
  };
}

function buildCoupledSummary(record = {}) {
  const baselineMetrics = toSummaryMetrics(record?.baseline?.cfd_proxy)
    || toSummaryMetrics(record?.baseline?.vlm)
    || null;

  const optimizedMetrics = toSummaryMetrics(record?.optimization?.optimized_metrics)
    || toSummaryMetrics(record?.optimization?.cfd_proxy_optimized)
    || null;

  const baselineLOverD = toSafeNumber(baselineMetrics?.l_over_d, null);
  const optimizedLOverD = toSafeNumber(optimizedMetrics?.l_over_d, null);

  const lOverDDelta = Number.isFinite(baselineLOverD) && Number.isFinite(optimizedLOverD)
    ? toFixedNumber(optimizedLOverD - baselineLOverD, 6)
    : null;

  const cdDelta = Number.isFinite(toSafeNumber(baselineMetrics?.cd, null))
    && Number.isFinite(toSafeNumber(optimizedMetrics?.cd, null))
    ? toFixedNumber(optimizedMetrics.cd - baselineMetrics.cd, 6)
    : null;

  return {
    simulation_id: record.simulation_id || null,
    status: record.status || 'unknown',
    baseline: baselineMetrics,
    optimized: optimizedMetrics,
    deltas: {
      l_over_d: lOverDDelta,
      cd: cdDelta,
    },
    selected_ratio: toSafeNumber(record?.optimization?.optimized_metrics?.selected_ratio, null),
    quantum_method: record?.optimization?.quantum?.method || null,
    coupling_iterations: Array.isArray(record?.optimization?.coupling_history)
      ? record.optimization.coupling_history.length
      : 0,
  };
}

function buildWindTunnelSessionPayload({
  sessionId,
  request,
  simulation,
  flowField,
  flowSource,
  generatedAt,
}) {
  const selectedNodeIds = Array.isArray(simulation?.optimization?.quantum?.active_nodes)
    ? simulation.optimization.quantum.active_nodes.map((node) => node.node_id)
    : [];

  const nodeHotspots = buildNodeHotspots(
    simulation?.visualizations?.vlm_nodes || [],
    selectedNodeIds
  );

  const timeline = Array.isArray(simulation?.workflow_timeline)
    ? simulation.workflow_timeline
    : [];

  return {
    wind_tunnel_session_id: sessionId,
    contract_version: WIND_TUNNEL_CONTRACT_VERSION,
    generated_at: generatedAt,
    scenario: request.scenario,
    tunnel: request.tunnel,
    request: {
      geometry: request.geometry,
      conditions: request.conditions,
      simulation: request.simulation,
    },
    flow_field: {
      ...flowField,
      source: flowSource,
      counts: {
        vectors: Array.isArray(flowField?.vectors) ? flowField.vectors.length : 0,
        streamlines: Array.isArray(flowField?.streamlines) ? flowField.streamlines.length : 0,
        vortex_cores: Array.isArray(flowField?.vortexCores) ? flowField.vortexCores.length : 0,
        pressure_samples: Array.isArray(flowField?.pressureData) ? flowField.pressureData.length : 0,
      },
    },
    coupled_results: {
      simulation_id: simulation?.simulation_id || null,
      status: simulation?.status || 'unknown',
      workflow: simulation?.workflow || {},
      workflow_timeline: timeline,
      summary: buildCoupledSummary(simulation),
      node_hotspots: nodeHotspots,
      baseline: simulation?.baseline || null,
      optimization: simulation?.optimization || null,
    },
    references: {
      simulation_result_url: simulation?.simulation_id
        ? `/api/simulation/${simulation.simulation_id}`
        : null,
      simulation_timeline_url: simulation?.simulation_id
        ? `/api/simulation/${simulation.simulation_id}/timeline`
        : null,
      wind_tunnel_session_url: `/api/simulation/wind-tunnel/${sessionId}`,
    },
  };
}

module.exports = {
  WIND_TUNNEL_CONTRACT_VERSION,
  getWindTunnelConfigContract,
  normalizeWindTunnelRequest,
  buildWindTunnelFlowFallback,
  normalizeFlowFieldPayload,
  buildNodeHotspots,
  buildCoupledSummary,
  buildWindTunnelSessionPayload,
};
