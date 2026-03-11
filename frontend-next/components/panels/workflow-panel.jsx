'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import MetricCard from '@/components/ui/metric-card';
import { getJson } from '@/lib/api-client';
import { num, since } from '@/lib/format';

const STAGE_ORDER = [
  { id: 'physics', name: 'Physics Validator', workflowKey: 'physics' },
  { id: 'ml', name: 'ML Surrogate', workflowKey: 'ml' },
  { id: 'quantum', name: 'Quantum Optimizer', workflowKey: 'quantum' },
  { id: 'cfd_proxy', name: 'CFD Coupling', workflowKey: 'cfd_proxy' },
  { id: 'analysis', name: 'Analysis Agent', workflowKey: null },
  { id: 'report', name: 'Report Generator', workflowKey: null },
];

function normalizeStatus(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'completed' || raw === 'skipped') return 'completed';
  if (raw === 'running') return 'running';
  if (raw === 'failed') return 'failed';
  if (raw === 'degraded') return 'degraded';
  return 'pending';
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function chooseSimulation(simulations, selectedId) {
  if (selectedId) {
    const explicit = simulations.find((sim) => sim.simulation_id === selectedId);
    if (explicit) return explicit;
  }
  const running = simulations.find((sim) => sim.status === 'running');
  if (running) return running;
  return simulations[0] || null;
}

function statusTone(status) {
  if (status === 'completed') return 'good';
  if (status === 'running' || status === 'degraded') return 'warn';
  if (status === 'failed') return 'danger';
  return 'default';
}

export default function WorkflowPanel() {
  const [simulations, setSimulations] = useState([]);
  const [selectedSimulationId, setSelectedSimulationId] = useState('');
  const [workflowDetail, setWorkflowDetail] = useState(null);
  const [timelineDetail, setTimelineDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshWorkflow = useCallback(async () => {
    setLoading(true);
    try {
      const listResponse = await getJson('/api/simulation', {
        limit: 30,
        include_failed: true,
      });
      const sims = listResponse?.data?.simulations || [];
      setSimulations(sims);

      const chosen = chooseSimulation(sims, selectedSimulationId);
      if (!chosen) {
        setWorkflowDetail(null);
        setTimelineDetail(null);
        setError('');
        return;
      }

      if (!selectedSimulationId || !sims.some((sim) => sim.simulation_id === selectedSimulationId)) {
        setSelectedSimulationId(chosen.simulation_id);
      }

      const [detailResponse, timelineResponse] = await Promise.all([
        getJson(`/api/simulation/${chosen.simulation_id}`),
        getJson(`/api/simulation/${chosen.simulation_id}/timeline`),
      ]);
      setWorkflowDetail(detailResponse?.data || null);
      setTimelineDetail(timelineResponse?.data || null);
      setError('');
    } catch (requestError) {
      setError(requestError?.message || 'Failed to load workflow state');
    } finally {
      setLoading(false);
    }
  }, [selectedSimulationId]);

  useEffect(() => {
    refreshWorkflow();
    const interval = setInterval(refreshWorkflow, 5000);
    return () => clearInterval(interval);
  }, [refreshWorkflow]);

  const nodes = useMemo(() => {
    const timelineStages = Array.isArray(timelineDetail?.stages) ? timelineDetail.stages : [];
    const indexed = new Map(timelineStages.map((stage) => [stage.id, stage]));
    const workflow = workflowDetail?.workflow || {};

    return STAGE_ORDER.map((stage, idx) => {
      const timelineStage = indexed.get(stage.id);
      const status = normalizeStatus(
        timelineStage?.status || (stage.workflowKey ? workflow[stage.workflowKey] : 'pending')
      );
      const duration = toFiniteNumber(timelineStage?.duration_s);

      return {
        id: stage.id,
        index: idx,
        name: stage.name,
        status,
        duration,
        details: timelineStage?.details || {},
      };
    });
  }, [timelineDetail, workflowDetail]);

  const summary = useMemo(() => {
    const completed = nodes.filter((node) => node.status === 'completed').length;
    const running = nodes.filter((node) => node.status === 'running' || node.status === 'degraded').length;
    const timelineDuration = toFiniteNumber(timelineDetail?.total_duration_s);
    return {
      completed,
      running,
      total: nodes.length,
      timelineDuration,
    };
  }, [nodes, timelineDetail]);

  return (
    <div className="qa-panel-grid">
      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h2>Workflow Timeline</h2>
          <p>Stage durations from explicit backend timeline contracts.</p>
        </header>

        {loading ? <p className="qa-inline-info">Loading orchestration timeline...</p> : null}
        {error ? <p className="qa-inline-error">{error}</p> : null}

        <div className="qa-form-grid">
          <label>
            <span>Simulation</span>
            <select
              value={selectedSimulationId}
              onChange={(event) => setSelectedSimulationId(event.target.value)}
            >
              {simulations.length === 0 ? <option value="">No simulations found</option> : null}
              {simulations.map((sim) => (
                <option key={sim.simulation_id} value={sim.simulation_id}>
                  {sim.simulation_id} ({sim.status})
                </option>
              ))}
            </select>
          </label>
          <button className="qa-primary-btn" type="button" onClick={refreshWorkflow}>
            Refresh
          </button>
          <div className="qa-readonly-field">
            <span>Updated</span>
            <strong>{since(workflowDetail?.completed_at || workflowDetail?.started_at)}</strong>
          </div>
        </div>

        <div className="qa-metric-grid">
          <MetricCard label="Simulation Status" value={workflowDetail?.status || 'n/a'} />
          <MetricCard label="Completed Stages" value={`${summary.completed}/${summary.total}`} tone="good" />
          <MetricCard label="Running Stages" value={String(summary.running)} tone={summary.running > 0 ? 'warn' : 'good'} />
          <MetricCard
            label="Timeline Duration"
            value={summary.timelineDuration !== null ? `${num(summary.timelineDuration, 2)}s` : 'in-progress'}
            tone="default"
          />
        </div>
      </section>

      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h3>Stage Progression</h3>
        </header>
        <div className="qa-stage-list">
          {nodes.map((node, idx) => (
            <article key={node.id} className={`qa-stage-card qa-stage-${statusTone(node.status)}`}>
              <div className="qa-stage-head">
                <div>
                  <p className="qa-stage-title">{node.name}</p>
                  <p className="qa-stage-meta">{node.id}</p>
                </div>
                <div className="qa-stage-right">
                  <span className={`qa-badge qa-badge-${node.status}`}>{node.status}</span>
                  <span className="qa-stage-meta">
                    {node.duration !== null ? `${num(node.duration, 2)}s` : '-'}
                  </span>
                </div>
              </div>
              {idx < nodes.length - 1 ? <div className="qa-stage-arrow">↓</div> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h3>Workflow Payload</h3>
          <p>Used to validate parity with legacy workflow debugger.</p>
        </header>
        <div className="qa-json-grid qa-json-grid-single">
          <pre>{JSON.stringify({
            simulation_id: workflowDetail?.simulation_id || null,
            status: workflowDetail?.status || 'no_data',
            workflow: workflowDetail?.workflow || null,
            timeline: timelineDetail?.stages || [],
            optimization: workflowDetail?.optimization || null,
          }, null, 2)}</pre>
        </div>
      </section>
    </div>
  );
}
