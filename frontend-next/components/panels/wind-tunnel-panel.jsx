'use client';

import { useEffect, useMemo, useState } from 'react';
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

function withDefaults(contract) {
  return {
    scenario_id: contract?.default_request?.scenario_id || '',
    geometry: contract?.default_request?.geometry || {},
    conditions: contract?.default_request?.conditions || {},
    tunnel: contract?.default_request?.tunnel || {},
    simulation: contract?.default_request?.simulation || {},
  };
}

export default function WindTunnelPanel() {
  const [config, setConfig] = useState(null);
  const [requestPayload, setRequestPayload] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;

    const loadContract = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await getJson('/api/simulation/wind-tunnel/config');
        if (disposed) return;
        const contract = response?.data || null;
        setConfig(contract);
        setRequestPayload(withDefaults(contract));
      } catch (requestError) {
        if (disposed) return;
        setError(requestError?.message || 'Failed to load wind tunnel contract');
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    loadContract();

    return () => {
      disposed = true;
    };
  }, []);

  const spanwise = useMemo(() => {
    const distribution = result?.coupled_results?.node_hotspots?.spanwise_distribution || [];
    return distribution.map((item) => ({
      span: item.span_index,
      avg_lift: Number(item.avg_lift || 0),
      avg_drag: Number(item.avg_drag || 0),
    }));
  }, [result]);

  const scenarios = config?.scenarios || [];

  const runSession = async () => {
    if (!requestPayload) return;
    setError('');
    setRunning(true);
    try {
      const response = await postJson('/api/simulation/wind-tunnel/run', requestPayload);
      setResult(response?.data || null);
    } catch (requestError) {
      setError(requestError?.message || 'Wind tunnel run failed');
    } finally {
      setRunning(false);
    }
  };

  const updateCondition = (key, value) => {
    setRequestPayload((prev) => ({
      ...prev,
      conditions: {
        ...(prev?.conditions || {}),
        [key]: value,
      },
    }));
  };

  const updateSimulation = (key, value) => {
    setRequestPayload((prev) => ({
      ...prev,
      simulation: {
        ...(prev?.simulation || {}),
        [key]: value,
      },
    }));
  };

  const selectScenario = (scenarioId) => {
    const scenario = scenarios.find((item) => item.id === scenarioId);
    setRequestPayload((prev) => ({
      ...prev,
      scenario_id: scenarioId,
      geometry: scenario?.default_geometry || prev?.geometry || {},
      conditions: {
        ...(prev?.conditions || {}),
        ...(scenario?.default_conditions || {}),
      },
    }));
  };

  const summary = result?.coupled_results?.summary;
  const flowCounts = result?.flow_field?.counts || {};

  return (
    <div className="qa-panel-grid">
      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h2>Wind Tunnel Lab</h2>
          <p>Next.js dark dashboard using your new wind-tunnel contracts with VLM + quantum coupling.</p>
        </header>

        {loading ? <p className="qa-inline-info">Loading contract defaults...</p> : null}
        {error ? <p className="qa-inline-error">{error}</p> : null}

        {requestPayload ? (
          <div className="qa-form-grid">
            <label>
              <span>Scenario</span>
              <select value={requestPayload.scenario_id || ''} onChange={(e) => selectScenario(e.target.value)}>
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Velocity (m/s)</span>
              <input
                type="number"
                value={requestPayload.conditions?.velocity ?? ''}
                onChange={(e) => updateCondition('velocity', Number(e.target.value))}
              />
            </label>

            <label>
              <span>Alpha (deg)</span>
              <input
                type="number"
                step="0.1"
                value={requestPayload.conditions?.alpha ?? ''}
                onChange={(e) => updateCondition('alpha', Number(e.target.value))}
              />
            </label>

            <label>
              <span>Yaw (deg)</span>
              <input
                type="number"
                step="0.1"
                value={requestPayload.conditions?.yaw ?? ''}
                onChange={(e) => updateCondition('yaw', Number(e.target.value))}
              />
            </label>

            <label>
              <span>Coupling Iterations</span>
              <input
                type="number"
                min="1"
                max="20"
                value={requestPayload.simulation?.coupling_iterations ?? 4}
                onChange={(e) => updateSimulation('coupling_iterations', Number(e.target.value))}
              />
            </label>

            <button className="qa-primary-btn" onClick={runSession} disabled={running} type="button">
              {running ? 'Running Session...' : 'Run Wind Tunnel Session'}
            </button>
          </div>
        ) : null}
      </section>

      <section className="qa-panel-block">
        <header className="qa-panel-header">
          <h3>Run Summary</h3>
        </header>
        <div className="qa-metric-grid qa-metric-grid-1">
          <MetricCard label="Baseline L/D" value={num(summary?.baseline?.l_over_d, 3)} />
          <MetricCard label="Optimized L/D" value={num(summary?.optimized?.l_over_d, 3)} tone="good" />
          <MetricCard label="CD Delta" value={num(summary?.deltas?.cd, 4)} tone={Number(summary?.deltas?.cd) <= 0 ? 'good' : 'warn'} />
          <MetricCard label="Quantum Method" value={summary?.quantum_method || 'n/a'} subtitle={`${summary?.coupling_iterations || 0} iterations`} />
        </div>
      </section>

      <section className="qa-panel-block">
        <header className="qa-panel-header">
          <h3>Flow Field Payload</h3>
        </header>
        <div className="qa-flow-preview">
          <div className="qa-flow-aura" />
          <div className="qa-flow-particle qa-flow-particle-a" />
          <div className="qa-flow-particle qa-flow-particle-b" />
          <div className="qa-flow-particle qa-flow-particle-c" />
          <div className="qa-flow-meta">
            <p><strong>Source:</strong> {result?.flow_field?.source || 'n/a'}</p>
            <p><strong>Vectors:</strong> {flowCounts.vectors || 0}</p>
            <p><strong>Streamlines:</strong> {flowCounts.streamlines || 0}</p>
            <p><strong>Vortex Cores:</strong> {flowCounts.vortex_cores || 0}</p>
            <p><strong>Pressure Samples:</strong> {flowCounts.pressure_samples || 0}</p>
          </div>
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
              <XAxis dataKey="span" stroke="rgba(255,255,255,0.7)" />
              <YAxis stroke="rgba(255,255,255,0.7)" />
              <Tooltip />
              <Bar dataKey="avg_lift" fill="#6ba8ff" radius={[8, 8, 0, 0]} />
              <Bar dataKey="avg_drag" fill="#ffa088" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
