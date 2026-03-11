'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import MetricCard from '@/components/ui/metric-card';
import { getJson, postJson } from '@/lib/api-client';
import { num } from '@/lib/format';

const DEFAULT_GEOMETRY = {
  span: 1.2,
  chord: 0.28,
  twist: -1.0,
  dihedral: 0.0,
  sweep: 6.0,
  taper_ratio: 0.75,
};

const DEFAULT_CONDITIONS = {
  velocity: 72,
  alpha: 4.5,
  yaw: 0.5,
  rho: 1.225,
  n_panels_x: 20,
  n_panels_y: 10,
};

const OPTIMIZATION_TYPES = [
  { value: 'front_wing', label: 'Front Wing', endpoint: '/api/quantum/optimize-wing' },
  { value: 'rear_wing', label: 'Rear Wing', endpoint: '/api/quantum/optimize-wing' },
  { value: 'complete_car', label: 'Complete Car', endpoint: '/api/quantum/optimize-complete-car' },
  { value: 'stiffener_layout', label: 'Stiffener Layout', endpoint: '/api/quantum/optimize-stiffener-layout' },
  { value: 'cooling_topology', label: 'Cooling Topology', endpoint: '/api/quantum/optimize-cooling-topology' },
  { value: 'transient_design', label: 'Transient Design', endpoint: '/api/quantum/optimize-transient' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildQuantumPayload(type, config) {
  if (type === 'front_wing') {
    return {
      wing_type: 'front',
      objectives: ['maximize_downforce', 'minimize_drag'],
      use_quantum: config.use_quantum,
      n_iterations: config.n_iterations,
    };
  }
  if (type === 'rear_wing') {
    return {
      wing_type: 'rear',
      objectives: ['maximize_downforce', 'minimize_drag'],
      use_quantum: config.use_quantum,
      n_iterations: config.n_iterations,
    };
  }
  if (type === 'complete_car') {
    return {
      objectives: ['maximize_downforce', 'minimize_drag', 'optimize_balance'],
      include_aeroelastic: true,
      include_transient: config.include_transient,
      use_quantum: config.use_quantum,
      n_iterations: config.n_iterations,
    };
  }
  if (type === 'stiffener_layout') {
    return {
      n_locations: 20,
      max_stiffeners: 8,
      target_frequency: 50.0,
      use_quantum: config.use_quantum,
    };
  }
  if (type === 'cooling_topology') {
    return {
      grid_size: [10, 10, 5],
      max_temperature: 1000.0,
      use_quantum: config.use_quantum,
    };
  }
  if (type === 'transient_design') {
    return {
      scenario: 'corner_exit',
      include_vibration: config.include_vibration,
      include_thermal: config.include_thermal,
      include_acoustic: config.include_acoustic,
      n_iterations: config.n_iterations,
      use_quantum: config.use_quantum,
    };
  }
  return { use_quantum: config.use_quantum };
}

function resolveOptimizationEndpoint(type) {
  return OPTIMIZATION_TYPES.find((option) => option.value === type)?.endpoint || '/api/quantum/optimize';
}

function toDisplayNodes(nodes = []) {
  return nodes.slice(0, 6).map((node) => ({
    node_id: node.node_id,
    lift: Number(node.lift || 0),
    drag: Number(node.drag || 0),
    span: Number(node.span_position || node.span_index || 0),
    score: Number((Number(node.lift || 0) - Math.abs(Number(node.drag || 0))).toFixed(6)),
  }));
}

export default function QuantumPanel() {
  const [optimizationType, setOptimizationType] = useState('complete_car');
  const [geometry] = useState(DEFAULT_GEOMETRY);
  const [conditions, setConditions] = useState(DEFAULT_CONDITIONS);
  const [config, setConfig] = useState({
    use_quantum: true,
    use_ml_surrogate: true,
    use_cfd_adapter: true,
    include_vibration: true,
    include_thermal: true,
    include_acoustic: true,
    include_transient: true,
    n_iterations: 8,
    run_async: false,
    max_nodes: 24,
  });
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const startOptimization = async () => {
    setStatus('running');
    setError('');
    try {
      const endpoint = resolveOptimizationEndpoint(optimizationType);
      const quantumPayload = buildQuantumPayload(optimizationType, config);

      const [quantumRes, simRes] = await Promise.all([
        postJson(endpoint, quantumPayload),
        postJson('/api/simulation/run', {
          geometry,
          conditions,
          optimization: true,
          use_quantum: config.use_quantum,
          use_ml_surrogate: config.use_ml_surrogate,
          use_cfd_adapter: config.use_cfd_adapter,
          coupling_iterations: config.n_iterations,
          async_mode: config.run_async,
          optimization_weights: {
            drag: 1.0,
            lift: 1.0,
            max_nodes: config.max_nodes,
          },
        }),
      ]);

      let simulationData = simRes?.data || null;
      if (config.run_async && simulationData?.simulation_id) {
        let pollCount = 0;
        while (pollCount < 120) {
          await sleep(1000);
          const poll = await getJson(`/api/simulation/${simulationData.simulation_id}`);
          simulationData = poll?.data || simulationData;
          if (['completed', 'degraded', 'failed'].includes(simulationData?.status)) {
            break;
          }
          pollCount += 1;
        }
      }

      setResult({
        quantum: quantumRes || null,
        simulation: simulationData || null,
      });
      setStatus('completed');
    } catch (requestError) {
      setStatus('error');
      setError(requestError?.message || 'Quantum optimization failed');
    }
  };

  const baseline = result?.simulation?.baseline?.cfd_proxy;
  const optimized = result?.simulation?.optimization?.cfd_proxy_optimized
    || result?.simulation?.optimization?.optimized_metrics;
  const nodeAnalytics = result?.simulation?.visualizations?.node_analytics || {};
  const couplingHistory = Array.isArray(result?.simulation?.optimization?.coupling_history)
    ? result.simulation.optimization.coupling_history
    : [];

  const topLiftNodes = useMemo(() => {
    if (Array.isArray(nodeAnalytics.top_lift_nodes) && nodeAnalytics.top_lift_nodes.length > 0) {
      return toDisplayNodes(nodeAnalytics.top_lift_nodes);
    }
    const fallback = Array.isArray(result?.simulation?.visualizations?.vlm_nodes)
      ? result.simulation.visualizations.vlm_nodes
      : [];
    return toDisplayNodes([...fallback].sort((a, b) => Number(b.lift || 0) - Number(a.lift || 0)));
  }, [nodeAnalytics, result]);

  const topDragNodes = useMemo(() => {
    if (Array.isArray(nodeAnalytics.top_drag_nodes) && nodeAnalytics.top_drag_nodes.length > 0) {
      return toDisplayNodes(nodeAnalytics.top_drag_nodes);
    }
    const fallback = Array.isArray(result?.simulation?.visualizations?.vlm_nodes)
      ? result.simulation.visualizations.vlm_nodes
      : [];
    return toDisplayNodes(
      [...fallback].sort((a, b) => Math.abs(Number(b.drag || 0)) - Math.abs(Number(a.drag || 0)))
    );
  }, [nodeAnalytics, result]);

  const spanwise = Array.isArray(nodeAnalytics.spanwise_distribution)
    ? nodeAnalytics.spanwise_distribution.map((item) => ({
      span: Number(item.span_index || item.span || 0),
      avg_lift: Number(item.avg_lift || 0),
      avg_drag: Number(item.avg_drag || 0),
    }))
    : [];

  return (
    <div className="qa-panel-grid">
      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h2>Quantum Optimization</h2>
          <p>Coupled quantum + CFD execution with VLM node drag/lift analytics.</p>
        </header>

        {error ? <p className="qa-inline-error">{error}</p> : null}
        {status === 'running' ? <p className="qa-inline-info">Running coupled optimization...</p> : null}

        <div className="qa-form-grid">
          <label>
            <span>Optimization Scope</span>
            <select value={optimizationType} onChange={(event) => setOptimizationType(event.target.value)}>
              {OPTIMIZATION_TYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Iterations</span>
            <input
              type="number"
              min="1"
              max="30"
              value={config.n_iterations}
              onChange={(event) => setConfig((prev) => ({
                ...prev,
                n_iterations: Number(event.target.value) || 1,
              }))}
            />
          </label>

          <label>
            <span>Panels (X x Y)</span>
            <input
              type="text"
              value={`${conditions.n_panels_x} x ${conditions.n_panels_y}`}
              readOnly
            />
          </label>

          <label>
            <span>Velocity (m/s)</span>
            <input
              type="number"
              value={conditions.velocity}
              onChange={(event) => setConditions((prev) => ({
                ...prev,
                velocity: Number(event.target.value) || 0,
              }))}
            />
          </label>

          <label>
            <span>Alpha (deg)</span>
            <input
              type="number"
              step="0.1"
              value={conditions.alpha}
              onChange={(event) => setConditions((prev) => ({
                ...prev,
                alpha: Number(event.target.value) || 0,
              }))}
            />
          </label>

          <button type="button" className="qa-primary-btn" onClick={startOptimization} disabled={status === 'running'}>
            {status === 'running' ? 'Running...' : 'Start Coupled Run'}
          </button>
        </div>

        <div className="qa-toggle-row">
          <label>
            <input
              type="checkbox"
              checked={config.use_quantum}
              onChange={(event) => setConfig((prev) => ({ ...prev, use_quantum: event.target.checked }))}
            />
            <span>Use quantum solver</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.use_ml_surrogate}
              onChange={(event) => setConfig((prev) => ({ ...prev, use_ml_surrogate: event.target.checked }))}
            />
            <span>Use ML surrogate</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.use_cfd_adapter}
              onChange={(event) => setConfig((prev) => ({ ...prev, use_cfd_adapter: event.target.checked }))}
            />
            <span>Use CFD adapter</span>
          </label>
        </div>

        <div className="qa-metric-grid">
          <MetricCard label="Quantum Method" value={result?.quantum?.data?.method || result?.quantum?.method || 'n/a'} />
          <MetricCard label="Baseline L/D" value={baseline ? num(baseline.l_over_d, 3) : 'n/a'} />
          <MetricCard label="Optimized L/D" value={optimized ? num(optimized.l_over_d, 3) : 'n/a'} tone="good" />
          <MetricCard
            label="CD Delta"
            value={baseline && optimized ? num(Number(optimized.cd || 0) - Number(baseline.cd || 0), 5) : 'n/a'}
            tone={baseline && optimized && Number(optimized.cd || 0) <= Number(baseline.cd || 0) ? 'good' : 'warn'}
          />
        </div>
      </section>

      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h3>Spanwise Lift vs Drag</h3>
        </header>
        <div className="qa-chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={spanwise}>
              <CartesianGrid strokeDasharray="4 4" stroke="rgba(255,255,255,0.12)" />
              <XAxis dataKey="span" stroke="rgba(255,255,255,0.68)" />
              <YAxis stroke="rgba(255,255,255,0.68)" />
              <Tooltip />
              <Bar dataKey="avg_lift" fill="#7ab4ff" radius={[8, 8, 0, 0]} />
              <Bar dataKey="avg_drag" fill="#ffab95" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="qa-panel-block">
        <header className="qa-panel-header">
          <h3>Top Lift Nodes</h3>
        </header>
        <div className="qa-simple-list">
          {topLiftNodes.map((node) => (
            <p key={`lift-${node.node_id}`}>
              <strong>{node.node_id}</strong>
              <span>L {num(node.lift, 3)} | D {num(node.drag, 3)}</span>
            </p>
          ))}
          {topLiftNodes.length === 0 ? <p className="qa-empty">No node analytics yet.</p> : null}
        </div>
      </section>

      <section className="qa-panel-block">
        <header className="qa-panel-header">
          <h3>Top Drag Nodes</h3>
        </header>
        <div className="qa-simple-list">
          {topDragNodes.map((node) => (
            <p key={`drag-${node.node_id}`}>
              <strong>{node.node_id}</strong>
              <span>D {num(node.drag, 3)} | Score {num(node.score, 3)}</span>
            </p>
          ))}
          {topDragNodes.length === 0 ? <p className="qa-empty">No node analytics yet.</p> : null}
        </div>
      </section>

      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h3>Coupling Iterations</h3>
        </header>
        <div className="qa-json-grid qa-json-grid-single">
          <pre>{JSON.stringify(couplingHistory, null, 2)}</pre>
        </div>
      </section>
    </div>
  );
}
