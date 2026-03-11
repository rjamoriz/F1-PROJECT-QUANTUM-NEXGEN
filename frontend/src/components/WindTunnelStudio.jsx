import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Wind } from './lucideShim';
import { BACKEND_API_BASE } from '../config/endpoints';

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatMetric(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 'n/a';
  }
  return numeric.toFixed(digits);
}

const WindTunnelStudio = () => {
  const [config, setConfig] = useState(null);
  const [requestPayload, setRequestPayload] = useState(null);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      setStatus('loading');
      setError('');

      try {
        const response = await axios.get(`${BACKEND_API_BASE}/api/simulation/wind-tunnel/config`);
        const contract = response?.data?.data || null;

        if (cancelled) {
          return;
        }

        setConfig(contract);
        setRequestPayload({
          scenario_id: contract?.default_request?.scenario_id,
          geometry: contract?.default_request?.geometry || {},
          conditions: contract?.default_request?.conditions || {},
          tunnel: contract?.default_request?.tunnel || {},
          simulation: contract?.default_request?.simulation || {},
        });
        setStatus('idle');
      } catch (requestError) {
        if (cancelled) {
          return;
        }
        setError(requestError?.message || 'Failed to load wind tunnel config contract');
        setStatus('error');
      }
    };

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedScenario = useMemo(() => {
    if (!config?.scenarios || !requestPayload?.scenario_id) {
      return null;
    }
    return config.scenarios.find((scenario) => scenario.id === requestPayload.scenario_id) || null;
  }, [config, requestPayload]);

  const spanwiseChartData = useMemo(() => {
    const values = result?.coupled_results?.node_hotspots?.spanwise_distribution || [];
    return values.map((entry) => ({
      span: entry.span_index,
      avgLift: toSafeNumber(entry.avg_lift),
      avgDrag: toSafeNumber(entry.avg_drag),
      selectedRatioPercent: toSafeNumber(entry.selected_ratio) * 100,
    }));
  }, [result]);

  const updateScenario = (scenarioId) => {
    const scenario = (config?.scenarios || []).find((item) => item.id === scenarioId);
    setRequestPayload((previous) => ({
      ...(previous || {}),
      scenario_id: scenarioId,
      geometry: scenario?.default_geometry || previous?.geometry || {},
      conditions: {
        ...(previous?.conditions || {}),
        ...(scenario?.default_conditions || {}),
      },
    }));
  };

  const updateCondition = (key, value) => {
    setRequestPayload((previous) => ({
      ...(previous || {}),
      conditions: {
        ...(previous?.conditions || {}),
        [key]: value,
      },
    }));
  };

  const updateSimulation = (key, value) => {
    setRequestPayload((previous) => ({
      ...(previous || {}),
      simulation: {
        ...(previous?.simulation || {}),
        [key]: value,
      },
    }));
  };

  const updateOptimizationWeight = (key, value) => {
    setRequestPayload((previous) => ({
      ...(previous || {}),
      simulation: {
        ...(previous?.simulation || {}),
        optimization_weights: {
          ...(previous?.simulation?.optimization_weights || {}),
          [key]: value,
        },
      },
    }));
  };

  const runWindTunnel = async () => {
    if (!requestPayload) {
      return;
    }

    setStatus('running');
    setError('');

    try {
      const response = await axios.post(
        `${BACKEND_API_BASE}/api/simulation/wind-tunnel/run`,
        requestPayload
      );
      setResult(response?.data?.data || null);
      setStatus('idle');
    } catch (requestError) {
      setError(requestError?.message || 'Wind tunnel run failed');
      setStatus('error');
    }
  };

  const summary = result?.coupled_results?.summary;
  const nodeHotspots = result?.coupled_results?.node_hotspots;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Wind className="w-6 h-6" />
          Wind Tunnel Studio (Phase A)
        </h2>
        <p className="text-sm text-gray-600 mt-1">
          Coupled VLM + CFD proxy + quantum node optimization contract path for F1 aerodynamic surfaces.
        </p>

        {status === 'loading' && (
          <div className="mt-4 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
            Loading wind tunnel configuration contract...
          </div>
        )}

        {error && (
          <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {requestPayload && (
          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600">Scenario</label>
              <select
                className="mt-1 w-full rounded border px-3 py-2"
                value={requestPayload.scenario_id || ''}
                onChange={(event) => updateScenario(event.target.value)}
              >
                {(config?.scenarios || []).map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
              {selectedScenario?.description && (
                <p className="text-xs text-gray-500 mt-1">{selectedScenario.description}</p>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">Velocity (m/s)</label>
              <input
                type="number"
                className="mt-1 w-full rounded border px-3 py-2"
                value={requestPayload.conditions?.velocity ?? ''}
                onChange={(event) => updateCondition('velocity', Number(event.target.value))}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">Angle of Attack (deg)</label>
              <input
                type="number"
                step="0.1"
                className="mt-1 w-full rounded border px-3 py-2"
                value={requestPayload.conditions?.alpha ?? ''}
                onChange={(event) => updateCondition('alpha', Number(event.target.value))}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">Yaw (deg)</label>
              <input
                type="number"
                step="0.1"
                className="mt-1 w-full rounded border px-3 py-2"
                value={requestPayload.conditions?.yaw ?? ''}
                onChange={(event) => updateCondition('yaw', Number(event.target.value))}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">Coupling Iterations</label>
              <input
                type="number"
                min="1"
                max="20"
                className="mt-1 w-full rounded border px-3 py-2"
                value={requestPayload.simulation?.coupling_iterations ?? ''}
                onChange={(event) => updateSimulation('coupling_iterations', Number(event.target.value))}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">Quantum Max Nodes</label>
              <input
                type="number"
                min="4"
                max="40"
                className="mt-1 w-full rounded border px-3 py-2"
                value={requestPayload.simulation?.optimization_weights?.max_nodes ?? ''}
                onChange={(event) => updateOptimizationWeight('max_nodes', Number(event.target.value))}
              />
            </div>
          </div>
        )}

        {requestPayload && (
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={requestPayload.simulation?.optimization !== false}
                onChange={(event) => updateSimulation('optimization', event.target.checked)}
              />
              Optimization
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={requestPayload.simulation?.use_quantum !== false}
                onChange={(event) => updateSimulation('use_quantum', event.target.checked)}
              />
              Quantum
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={requestPayload.simulation?.use_ml_surrogate !== false}
                onChange={(event) => updateSimulation('use_ml_surrogate', event.target.checked)}
              />
              ML Surrogate
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={requestPayload.simulation?.use_cfd_adapter !== false}
                onChange={(event) => updateSimulation('use_cfd_adapter', event.target.checked)}
              />
              CFD Adapter
            </label>
          </div>
        )}

        <div className="mt-5">
          <button
            className="rounded bg-blue-700 px-4 py-2 text-white font-semibold hover:bg-blue-800 disabled:opacity-60"
            onClick={runWindTunnel}
            disabled={!requestPayload || status === 'running' || status === 'loading'}
          >
            {status === 'running' ? 'Running Coupled Wind Tunnel...' : 'Run Wind Tunnel Session'}
          </button>
        </div>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600">Baseline L/D</div>
              <div className="text-2xl font-bold text-blue-700">{formatMetric(summary?.baseline?.l_over_d, 3)}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600">Optimized L/D</div>
              <div className="text-2xl font-bold text-green-700">{formatMetric(summary?.optimized?.l_over_d, 3)}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600">CD Delta</div>
              <div className="text-2xl font-bold text-purple-700">{formatMetric(summary?.deltas?.cd, 4)}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600">Selected Node Ratio</div>
              <div className="text-2xl font-bold text-orange-700">
                {formatMetric(toSafeNumber(nodeHotspots?.selected_ratio, 0) * 100, 2)}%
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-lg font-semibold mb-3">Spanwise Lift/Drag Distribution</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={spanwiseChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="span" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="avgLift" fill="#1d4ed8" name="Avg Lift" />
                    <Bar dataKey="avgDrag" fill="#dc2626" name="Avg Drag" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-lg font-semibold mb-3">Flow Field Payload</h3>
              <div className="space-y-2 text-sm">
                <div><span className="font-semibold">Source:</span> {result.flow_field?.source}</div>
                <div><span className="font-semibold">Vectors:</span> {result.flow_field?.counts?.vectors || 0}</div>
                <div><span className="font-semibold">Streamlines:</span> {result.flow_field?.counts?.streamlines || 0}</div>
                <div><span className="font-semibold">Vortex Cores:</span> {result.flow_field?.counts?.vortex_cores || 0}</div>
                <div><span className="font-semibold">Pressure Samples:</span> {result.flow_field?.counts?.pressure_samples || 0}</div>
                <div><span className="font-semibold">Max Velocity:</span> {formatMetric(result.flow_field?.statistics?.maxVelocity, 3)}</div>
                <div><span className="font-semibold">Min Pressure:</span> {formatMetric(result.flow_field?.statistics?.minPressure, 3)}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-lg font-semibold mb-3">Top Lift Nodes</h3>
              <div className="max-h-64 overflow-y-auto text-sm">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-1">Node</th>
                      <th className="py-1">Span</th>
                      <th className="py-1">Lift</th>
                      <th className="py-1">Drag</th>
                      <th className="py-1">Selected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(nodeHotspots?.top_lift_nodes || []).map((node) => (
                      <tr key={`lift-${node.node_id}`} className="border-b border-gray-100">
                        <td className="py-1">{node.node_id}</td>
                        <td className="py-1">{node.span_index}</td>
                        <td className="py-1">{formatMetric(node.lift, 3)}</td>
                        <td className="py-1">{formatMetric(node.drag, 3)}</td>
                        <td className="py-1">{node.selected ? 'yes' : 'no'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-lg font-semibold mb-3">Top Drag Nodes</h3>
              <div className="max-h-64 overflow-y-auto text-sm">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-1">Node</th>
                      <th className="py-1">Span</th>
                      <th className="py-1">Lift</th>
                      <th className="py-1">Drag</th>
                      <th className="py-1">Selected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(nodeHotspots?.top_drag_nodes || []).map((node) => (
                      <tr key={`drag-${node.node_id}`} className="border-b border-gray-100">
                        <td className="py-1">{node.node_id}</td>
                        <td className="py-1">{node.span_index}</td>
                        <td className="py-1">{formatMetric(node.lift, 3)}</td>
                        <td className="py-1">{formatMetric(node.drag, 3)}</td>
                        <td className="py-1">{node.selected ? 'yes' : 'no'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default WindTunnelStudio;
