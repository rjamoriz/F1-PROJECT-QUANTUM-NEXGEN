/**
 * Quantum Optimization Panel
 * Controls quantum-integrated multi-physics optimization
 */

import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';

const API_BASE = BACKEND_API_BASE;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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

const optimizationTypes = [
  { value: 'front_wing', label: 'Front Wing Optimization' },
  { value: 'rear_wing', label: 'Rear Wing Optimization' },
  { value: 'complete_car', label: 'Complete Car Optimization' },
  { value: 'stiffener_layout', label: 'Stiffener Layout (Vibration)' },
  { value: 'cooling_topology', label: 'Cooling Topology (Thermal)' },
  { value: 'transient_design', label: 'Transient Performance' },
];

const endpointForOptimizationType = {
  front_wing: '/api/quantum/optimize-wing',
  rear_wing: '/api/quantum/optimize-wing',
  complete_car: '/api/quantum/optimize-complete-car',
  stiffener_layout: '/api/quantum/optimize-stiffener-layout',
  cooling_topology: '/api/quantum/optimize-cooling-topology',
  transient_design: '/api/quantum/optimize-transient',
};

const QuantumOptimizationPanel = () => {
  const [optimizationType, setOptimizationType] = useState('complete_car');
  const [config, setConfig] = useState({
    use_quantum: true,
    use_ml_surrogate: true,
    include_vibration: true,
    include_thermal: true,
    include_acoustic: true,
    include_transient: true,
    n_iterations: 10,
    max_nodes: 24,
    use_cfd_adapter: true,
    run_async: false,
  });

  const [geometry, setGeometry] = useState(DEFAULT_GEOMETRY);
  const [conditions, setConditions] = useState(DEFAULT_CONDITIONS);

  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const topNodeCandidates = useMemo(() => {
    const nodes = results?.simulation?.visualizations?.vlm_nodes || [];
    return [...nodes]
      .map((node) => ({
        ...node,
        score: (node.lift || 0) - Math.abs(node.drag || 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [results]);

  const handleGeometryChange = (key, value) => {
    setGeometry((prev) => ({ ...prev, [key]: value }));
  };

  const handleConditionChange = (key, value) => {
    setConditions((prev) => ({ ...prev, [key]: value }));
  };

  const buildQuantumPayload = () => {
    switch (optimizationType) {
      case 'front_wing':
        return {
          wing_type: 'front',
          objectives: ['maximize_downforce', 'minimize_drag'],
          use_quantum: config.use_quantum,
          n_iterations: config.n_iterations,
        };

      case 'rear_wing':
        return {
          wing_type: 'rear',
          objectives: ['maximize_downforce', 'minimize_drag'],
          use_quantum: config.use_quantum,
          n_iterations: config.n_iterations,
        };

      case 'complete_car':
        return {
          objectives: ['maximize_downforce', 'minimize_drag', 'optimize_balance'],
          include_aeroelastic: true,
          include_transient: config.include_transient,
          use_quantum: config.use_quantum,
          n_iterations: config.n_iterations,
        };

      case 'stiffener_layout':
        return {
          n_locations: 20,
          max_stiffeners: 8,
          target_frequency: 50.0,
          use_quantum: config.use_quantum,
        };

      case 'cooling_topology':
        return {
          grid_size: [10, 10, 5],
          max_temperature: 1000.0,
          use_quantum: config.use_quantum,
        };

      case 'transient_design':
        return {
          scenario: 'corner_exit',
          include_vibration: config.include_vibration,
          include_thermal: config.include_thermal,
          include_acoustic: config.include_acoustic,
          n_iterations: config.n_iterations,
          use_quantum: config.use_quantum,
        };

      default:
        return {
          use_quantum: config.use_quantum,
        };
    }
  };

  const startOptimization = async () => {
    setStatus('running');
    setError(null);

    try {
      const quantumEndpoint = endpointForOptimizationType[optimizationType];
      const quantumPayload = buildQuantumPayload();

      const [quantumResult, simulationStart] = await Promise.all([
        axios.post(`${API_BASE}${quantumEndpoint}`, quantumPayload),
        axios.post(`${API_BASE}/api/simulation/run`, {
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

      let simulationData = simulationStart.data?.data;
      if (config.run_async) {
        const simulationId = simulationStart.data?.data?.simulation_id;
        const maxPolls = 120;
        let pollCount = 0;

        while (simulationId && pollCount < maxPolls) {
          await sleep(1200);
          const pollResponse = await axios.get(`${API_BASE}/api/simulation/${simulationId}`);
          simulationData = pollResponse.data?.data;

          if (!simulationData || ['completed', 'degraded', 'failed'].includes(simulationData.status)) {
            break;
          }

          pollCount += 1;
        }
      }

      setResults({
        quantum: quantumResult.data,
        simulation: simulationData,
      });
      setStatus('completed');
    } catch (requestError) {
      setStatus('error');
      setError(requestError?.response?.data?.error || requestError.message || 'Unknown error');
      console.error('Optimization error:', requestError);
    }
  };

  const baseline = results?.simulation?.baseline?.cfd_proxy;
  const optimized = results?.simulation?.optimization?.cfd_proxy_optimized
    || results?.simulation?.optimization?.optimized_metrics;
  const couplingHistory = results?.simulation?.optimization?.coupling_history || [];
  const cfdInfo = results?.simulation?.cfd;
  const nodeAnalytics = results?.simulation?.visualizations?.node_analytics;

  const topLiftNodes = useMemo(() => {
    if (Array.isArray(nodeAnalytics?.top_lift_nodes) && nodeAnalytics.top_lift_nodes.length > 0) {
      return nodeAnalytics.top_lift_nodes.slice(0, 6);
    }
    return topNodeCandidates.slice(0, 6);
  }, [nodeAnalytics, topNodeCandidates]);

  const topDragNodes = useMemo(() => {
    if (Array.isArray(nodeAnalytics?.top_drag_nodes) && nodeAnalytics.top_drag_nodes.length > 0) {
      return nodeAnalytics.top_drag_nodes.slice(0, 6);
    }
    return [...topNodeCandidates]
      .sort((a, b) => Math.abs(b.drag || 0) - Math.abs(a.drag || 0))
      .slice(0, 6);
  }, [nodeAnalytics, topNodeCandidates]);

  const spanwiseDistribution = useMemo(
    () => (Array.isArray(nodeAnalytics?.spanwise_distribution) ? nodeAnalytics.spanwise_distribution : []),
    [nodeAnalytics]
  );

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Quantum + CFD Coupled Optimization</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <label className="block text-sm font-medium mb-2">Optimization Type</label>
          <select
            value={optimizationType}
            onChange={(e) => setOptimizationType(e.target.value)}
            className="w-full px-3 py-2 border rounded"
          >
            {optimizationTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Iterations</label>
          <input
            type="number"
            value={config.n_iterations}
            onChange={(e) => setConfig({ ...config, n_iterations: parseInt(e.target.value, 10) || 1 })}
            className="w-full px-3 py-2 border rounded"
            min="1"
            max="100"
          />
        </div>
      </div>

      <div className="mb-6 p-4 bg-gray-50 rounded">
        <h3 className="font-semibold mb-3">Flow Conditions</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div>
            <label className="block mb-1">Velocity (m/s)</label>
            <input
              type="number"
              value={conditions.velocity}
              onChange={(e) => handleConditionChange('velocity', parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1 border rounded"
            />
          </div>
          <div>
            <label className="block mb-1">Alpha (deg)</label>
            <input
              type="number"
              step="0.1"
              value={conditions.alpha}
              onChange={(e) => handleConditionChange('alpha', parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1 border rounded"
            />
          </div>
          <div>
            <label className="block mb-1">Yaw (deg)</label>
            <input
              type="number"
              step="0.1"
              value={conditions.yaw}
              onChange={(e) => handleConditionChange('yaw', parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1 border rounded"
            />
          </div>
          <div>
            <label className="block mb-1">Panels X</label>
            <input
              type="number"
              value={conditions.n_panels_x}
              onChange={(e) => handleConditionChange('n_panels_x', parseInt(e.target.value, 10) || 5)}
              className="w-full px-2 py-1 border rounded"
              min="5"
              max="40"
            />
          </div>
          <div>
            <label className="block mb-1">Panels Y</label>
            <input
              type="number"
              value={conditions.n_panels_y}
              onChange={(e) => handleConditionChange('n_panels_y', parseInt(e.target.value, 10) || 5)}
              className="w-full px-2 py-1 border rounded"
              min="5"
              max="30"
            />
          </div>
        </div>
      </div>

      <div className="mb-6 p-4 bg-gray-50 rounded">
        <h3 className="font-semibold mb-3">Geometry</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
          {Object.entries(geometry).map(([key, value]) => (
            <div key={key}>
              <label className="block mb-1">{key.replace('_', ' ')}</label>
              <input
                type="number"
                step="0.1"
                value={value}
                onChange={(e) => handleGeometryChange(key, parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 border rounded"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6 p-4 bg-gray-50 rounded">
        <h3 className="font-semibold mb-3">Solver Options</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.use_quantum}
              onChange={(e) => setConfig({ ...config, use_quantum: e.target.checked })}
              className="mr-2"
            />
            <span className="text-sm">Use Quantum Solver (QAOA/Auto)</span>
          </label>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.use_ml_surrogate}
              onChange={(e) => setConfig({ ...config, use_ml_surrogate: e.target.checked })}
              className="mr-2"
            />
            <span className="text-sm">Use ML Surrogate in Coupled Loop</span>
          </label>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.run_async}
              onChange={(e) => setConfig({ ...config, run_async: e.target.checked })}
              className="mr-2"
            />
            <span className="text-sm">Run Simulation Async (Poll Results)</span>
          </label>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.use_cfd_adapter}
              onChange={(e) => setConfig({ ...config, use_cfd_adapter: e.target.checked })}
              className="mr-2"
            />
            <span className="text-sm">Use CFD Adapter</span>
          </label>

          <div>
            <label className="block text-sm font-medium mb-1">Max Quantum Nodes</label>
            <input
              type="number"
              value={config.max_nodes}
              onChange={(e) => setConfig({ ...config, max_nodes: parseInt(e.target.value, 10) || 8 })}
              className="w-full px-3 py-2 border rounded"
              min="8"
              max="40"
            />
          </div>
        </div>
      </div>

      <button
        onClick={startOptimization}
        disabled={status === 'running'}
        className={`w-full px-6 py-3 rounded font-semibold mb-6 ${
          status === 'running'
            ? 'bg-gray-400 cursor-not-allowed text-white'
            : 'bg-blue-700 hover:bg-blue-800 text-white'
        }`}
      >
        {status === 'running'
          ? (config.run_async ? 'Running Async Coupled Optimization...' : 'Running Coupled Optimization...')
          : 'Run Quantum + CFD Coupled Optimization'}
      </button>

      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {String(error)}
        </div>
      )}

      {results && (
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded">
            <h3 className="font-semibold mb-2 text-blue-800">Quantum Optimization Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="p-2 bg-white rounded">
                <div className="text-gray-600">Best Fitness</div>
                <div className="font-bold">{results.quantum?.best_fitness?.toFixed?.(4) ?? 'n/a'}</div>
              </div>
              <div className="p-2 bg-white rounded">
                <div className="text-gray-600">Method</div>
                <div className="font-bold">{results.quantum?.quantum?.method || 'n/a'}</div>
              </div>
              <div className="p-2 bg-white rounded">
                <div className="text-gray-600">Iterations</div>
                <div className="font-bold">{results.quantum?.n_iterations ?? 'n/a'}</div>
              </div>
              <div className="p-2 bg-white rounded">
                <div className="text-gray-600">Simulation ID</div>
                <div className="font-bold">{results.simulation?.simulation_id || 'n/a'}</div>
              </div>
            </div>
          </div>

          {cfdInfo && (
            <div className="p-4 bg-indigo-50 border border-indigo-200 rounded">
              <h3 className="font-semibold mb-2 text-indigo-800">CFD Adapter Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="p-2 bg-white rounded">
                  <div className="text-gray-600">Adapter Enabled</div>
                  <div className="font-bold">{cfdInfo.adapter_enabled ? 'Yes' : 'No'}</div>
                </div>
                <div className="p-2 bg-white rounded">
                  <div className="text-gray-600">Engine</div>
                  <div className="font-bold">{cfdInfo.engine || 'n/a'}</div>
                </div>
                <div className="p-2 bg-white rounded">
                  <div className="text-gray-600">CFD Runs</div>
                  <div className="font-bold">{Array.isArray(cfdInfo.runs) ? cfdInfo.runs.length : 0}</div>
                </div>
                <div className="p-2 bg-white rounded">
                  <div className="text-gray-600">Workflow Status</div>
                  <div className="font-bold">{results.simulation?.workflow?.cfd_proxy || 'n/a'}</div>
                </div>
              </div>
            </div>
          )}

          {baseline && (
            <div className="p-4 bg-gray-50 border rounded">
              <h3 className="font-semibold mb-2">CFD Coupling Metrics (Baseline vs Optimized)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3 bg-white border rounded">
                  <div className="text-xs uppercase text-gray-500 mb-2">Baseline CFD Proxy</div>
                  <div className="text-sm">CL: <strong>{baseline.cl?.toFixed(4)}</strong></div>
                  <div className="text-sm">CD: <strong>{baseline.cd?.toFixed(4)}</strong></div>
                  <div className="text-sm">L/D: <strong>{baseline.l_over_d?.toFixed(4)}</strong></div>
                </div>

                <div className="p-3 bg-white border rounded">
                  <div className="text-xs uppercase text-gray-500 mb-2">Optimized</div>
                  <div className="text-sm">CL: <strong>{optimized?.cl?.toFixed?.(4) ?? 'n/a'}</strong></div>
                  <div className="text-sm">CD: <strong>{optimized?.cd?.toFixed?.(4) ?? 'n/a'}</strong></div>
                  <div className="text-sm">L/D: <strong>{optimized?.l_over_d?.toFixed?.(4) ?? 'n/a'}</strong></div>
                </div>
              </div>
            </div>
          )}

          {nodeAnalytics && (
            <div className="p-4 bg-teal-50 border border-teal-200 rounded">
              <h3 className="font-semibold mb-2 text-teal-800">Node Analytics Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                <div className="p-2 bg-white rounded">
                  <div className="text-gray-600">Total Nodes</div>
                  <div className="font-bold">{nodeAnalytics.total_nodes ?? 'n/a'}</div>
                </div>
                <div className="p-2 bg-white rounded">
                  <div className="text-gray-600">Selected Nodes</div>
                  <div className="font-bold">{nodeAnalytics.selected_nodes ?? 'n/a'}</div>
                </div>
                <div className="p-2 bg-white rounded">
                  <div className="text-gray-600">Selected Ratio</div>
                  <div className="font-bold">
                    {Number.isFinite(nodeAnalytics.selected_ratio)
                      ? `${(nodeAnalytics.selected_ratio * 100).toFixed(1)}%`
                      : 'n/a'}
                  </div>
                </div>
                <div className="p-2 bg-white rounded">
                  <div className="text-gray-600">Lift-Drag Correlation</div>
                  <div className="font-bold">
                    {Number.isFinite(nodeAnalytics.lift_drag_correlation)
                      ? Number(nodeAnalytics.lift_drag_correlation).toFixed(3)
                      : 'n/a'}
                  </div>
                </div>
              </div>

              {spanwiseDistribution.length > 0 && (
                <div className="p-3 bg-white border rounded text-sm">
                  <div className="font-medium mb-2">Spanwise Selection Snapshot</div>
                  <div className="space-y-1 max-h-40 overflow-auto">
                    {spanwiseDistribution.slice(0, 8).map((bucket) => (
                      <div key={`span-${bucket.span_index}`} className="flex justify-between">
                        <span>Span {bucket.span_index}</span>
                        <span className="font-medium">
                          nodes {bucket.selected_nodes}/{bucket.nodes} | L {bucket.avg_lift?.toFixed?.(3)} | D {bucket.avg_drag?.toFixed?.(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="p-4 bg-gray-50 border rounded">
            <h3 className="font-semibold mb-2">Top VLM Node Candidates (Lift - Drag Score)</h3>
            {topNodeCandidates.length === 0 && (
              <div className="text-sm text-gray-500">No VLM node data available.</div>
            )}
            {topNodeCandidates.length > 0 && (
              <div className="space-y-2">
                {topNodeCandidates.map((node) => (
                  <div key={node.node_id} className="p-2 bg-white border rounded text-sm flex justify-between">
                    <div>
                      Node {node.node_id} (span {node.span_index}, chord {node.chord_index})
                    </div>
                    <div className="font-medium">
                      Lift {node.lift?.toFixed?.(3)} | Drag {node.drag?.toFixed?.(3)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 border rounded">
              <h3 className="font-semibold mb-2">Top Lift Nodes</h3>
              {topLiftNodes.length === 0 && (
                <div className="text-sm text-gray-500">No node analytics available.</div>
              )}
              {topLiftNodes.length > 0 && (
                <div className="space-y-2">
                  {topLiftNodes.map((node) => (
                    <div key={`lift-${node.node_id}`} className="p-2 bg-white border rounded text-sm flex justify-between">
                      <span>Node {node.node_id} (s{node.span_index}, c{node.chord_index})</span>
                      <span className="font-medium">L {node.lift?.toFixed?.(3)} | D {node.drag?.toFixed?.(3)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 border rounded">
              <h3 className="font-semibold mb-2">Top Drag Nodes</h3>
              {topDragNodes.length === 0 && (
                <div className="text-sm text-gray-500">No node analytics available.</div>
              )}
              {topDragNodes.length > 0 && (
                <div className="space-y-2">
                  {topDragNodes.map((node) => (
                    <div key={`drag-${node.node_id}`} className="p-2 bg-white border rounded text-sm flex justify-between">
                      <span>Node {node.node_id} (s{node.span_index}, c{node.chord_index})</span>
                      <span className="font-medium">D {node.drag?.toFixed?.(3)} | L {node.lift?.toFixed?.(3)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {Array.isArray(results.quantum?.history) && results.quantum.history.length > 1 && (
            <div className="p-4 bg-gray-50 border rounded">
              <h3 className="font-semibold mb-2">Convergence History</h3>
              <div className="h-40 flex items-end gap-1">
                {results.quantum.history.map((point, idx) => {
                  const start = results.quantum.history[0]?.fitness || 1;
                  const denom = Math.abs(start) > 1e-9 ? Math.abs(start) : 1;
                  const progress = clamp(((start - point.fitness) / denom) * 100, 1, 100);

                  return (
                    <div
                      key={idx}
                      className="flex-1 bg-blue-600 rounded-t"
                      style={{ height: `${progress}%` }}
                      title={`Iteration ${point.iteration}: ${point.fitness}`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {Array.isArray(couplingHistory) && couplingHistory.length > 0 && (
            <div className="p-4 bg-gray-50 border rounded">
              <h3 className="font-semibold mb-2">Coupled Iteration History</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                <div className="h-36 flex items-end gap-1">
                  {couplingHistory.map((point) => {
                    const maxLd = Math.max(...couplingHistory.map((item) => item.l_over_d || 0), 1e-6);
                    const h = clamp(((point.l_over_d || 0) / maxLd) * 100, 1, 100);
                    return (
                      <div
                        key={`ld-${point.iteration}`}
                        className="flex-1 bg-emerald-600 rounded-t"
                        style={{ height: `${h}%` }}
                        title={`Iter ${point.iteration}: L/D ${point.l_over_d?.toFixed?.(4)}`}
                      />
                    );
                  })}
                </div>

                <div className="h-36 flex items-end gap-1">
                  {couplingHistory.map((point) => {
                    const maxNodes = Math.max(...couplingHistory.map((item) => item.selected_nodes || 0), 1);
                    const h = clamp(((point.selected_nodes || 0) / maxNodes) * 100, 1, 100);
                    return (
                      <div
                        key={`nodes-${point.iteration}`}
                        className="flex-1 bg-amber-600 rounded-t"
                        style={{ height: `${h}%` }}
                        title={`Iter ${point.iteration}: Selected ${point.selected_nodes}`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2 text-sm">
                {couplingHistory.map((point) => (
                  <div key={`row-${point.iteration}`} className="p-2 bg-white border rounded flex justify-between">
                    <span>Iteration {point.iteration}</span>
                    <span className="font-medium">
                      CL {point.cl?.toFixed?.(4)} | CD {point.cd?.toFixed?.(4)} | L/D {point.l_over_d?.toFixed?.(4)}
                      {Number.isFinite(point.residual_l2) ? ` | res ${Number(point.residual_l2).toExponential(2)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuantumOptimizationPanel;
