/**
 * Workflow Visualizer
 * Live workflow state and transitions sourced from simulation orchestration.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import { GitBranch, Play, CheckCircle, Circle, AlertCircle } from './lucideShim';

const API_BASE = BACKEND_API_BASE;

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

function secondsBetween(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const startedMs = new Date(startedAt).getTime();
  const completedMs = new Date(completedAt).getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs) || completedMs <= startedMs) return null;
  return Number(((completedMs - startedMs) / 1000).toFixed(2));
}

function secondsFromStart(startedAt) {
  if (!startedAt) return null;
  const startedMs = new Date(startedAt).getTime();
  const nowMs = Date.now();
  if (!Number.isFinite(startedMs) || nowMs <= startedMs) return null;
  return Number(((nowMs - startedMs) / 1000).toFixed(2));
}

function statusMeta(status) {
  switch (status) {
    case 'completed':
      return {
        icon: <CheckCircle className="w-5 h-5" />,
        color: 'bg-green-100 border-green-300 text-green-800',
      };
    case 'running':
      return {
        icon: <Play className="w-5 h-5 animate-pulse" />,
        color: 'bg-blue-100 border-blue-300 text-blue-800',
      };
    case 'degraded':
      return {
        icon: <AlertCircle className="w-5 h-5" />,
        color: 'bg-yellow-100 border-yellow-300 text-yellow-800',
      };
    case 'failed':
      return {
        icon: <AlertCircle className="w-5 h-5" />,
        color: 'bg-red-100 border-red-300 text-red-800',
      };
    default:
      return {
        icon: <Circle className="w-5 h-5" />,
        color: 'bg-gray-100 border-gray-300 text-gray-600',
      };
  }
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

const WorkflowVisualizer = () => {
  const [simulations, setSimulations] = useState([]);
  const [selectedSimulationId, setSelectedSimulationId] = useState('');
  const [workflowDetail, setWorkflowDetail] = useState(null);
  const [timelineDetail, setTimelineDetail] = useState(null);
  const [error, setError] = useState(null);

  const refreshWorkflow = useCallback(async () => {
    try {
      const listResponse = await axios.get(`${API_BASE}/api/simulation`, {
        params: {
          limit: 30,
          include_failed: true,
        },
      });

      const sims = listResponse?.data?.data?.simulations || [];
      setSimulations(sims);

      const chosen = chooseSimulation(sims, selectedSimulationId);
      if (!chosen) {
        setWorkflowDetail(null);
        setTimelineDetail(null);
        setError(null);
        return;
      }

      if (!selectedSimulationId || !sims.some((sim) => sim.simulation_id === selectedSimulationId)) {
        setSelectedSimulationId(chosen.simulation_id);
      }

      const [detailResponse, timelineResponse] = await Promise.all([
        axios.get(`${API_BASE}/api/simulation/${chosen.simulation_id}`),
        axios.get(`${API_BASE}/api/simulation/${chosen.simulation_id}/timeline`),
      ]);

      setWorkflowDetail(detailResponse?.data?.data || null);
      setTimelineDetail(timelineResponse?.data?.data || null);
      setError(null);
    } catch (requestError) {
      setError(requestError?.message || 'Failed to load workflow state');
    }
  }, [selectedSimulationId]);

  useEffect(() => {
    refreshWorkflow();
    const interval = setInterval(refreshWorkflow, 4000);
    return () => clearInterval(interval);
  }, [refreshWorkflow]);

  const nodes = useMemo(() => {
    const timelineStages = Array.isArray(timelineDetail?.stages) ? timelineDetail.stages : [];
    const indexedStages = new Map(timelineStages.map((stage) => [stage.id, stage]));
    const workflow = workflowDetail?.workflow || {};

    return STAGE_ORDER.map((stage, idx) => {
      const timelineStage = indexedStages.get(stage.id);
      const statusValue = timelineStage?.status
        || (stage.workflowKey ? workflow[stage.workflowKey] : 'pending');
      const status = normalizeStatus(statusValue);
      const recordedDuration = toFiniteNumber(timelineStage?.duration_s);
      const duration = recordedDuration !== null
        ? Number(recordedDuration.toFixed(2))
        : (status === 'running' ? secondsFromStart(timelineStage?.started_at) : null);

      return {
        id: stage.id,
        name: stage.name,
        status,
        duration,
        started_at: timelineStage?.started_at || null,
        completed_at: timelineStage?.completed_at || null,
        details: timelineStage?.details || {},
        index: idx,
      };
    });
  }, [workflowDetail, timelineDetail]);

  const currentNode = useMemo(() => {
    const running = nodes.find((node) => node.status === 'running' || node.status === 'degraded');
    if (running) return running.id;

    const pending = nodes.find((node) => node.status === 'pending');
    if (pending) return pending.id;

    return nodes[nodes.length - 1]?.id || null;
  }, [nodes]);

  const statePayload = useMemo(() => {
    if (!workflowDetail) {
      return {
        simulation_id: null,
        status: 'no_data',
      };
    }

    return {
      simulation_id: workflowDetail.simulation_id,
      status: workflowDetail.status,
      workflow: workflowDetail.workflow,
      geometry: workflowDetail.geometry,
      conditions: workflowDetail.conditions,
      baseline: {
        ml_surrogate: workflowDetail?.baseline?.ml_surrogate || null,
        cfd_proxy: workflowDetail?.baseline?.cfd_proxy || null,
      },
      optimization: workflowDetail?.optimization || null,
      timeline: timelineDetail?.stages || [],
      duration_s: secondsBetween(workflowDetail.started_at, workflowDetail.completed_at),
      started_at: workflowDetail.started_at,
      completed_at: workflowDetail.completed_at,
    };
  }, [workflowDetail, timelineDetail]);

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <GitBranch className="w-6 h-6" />
        Workflow Visualizer
      </h2>

      <p className="text-gray-600 mb-6">
        Live orchestration workflow from coupled simulation runs, with stage transitions and explicit stage timings.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {String(error)}
        </div>
      )}

      <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium">Simulation</label>
        <select
          value={selectedSimulationId}
          onChange={(e) => setSelectedSimulationId(e.target.value)}
          className="px-3 py-2 border rounded text-sm"
        >
          {simulations.length === 0 && <option value="">No simulations yet</option>}
          {simulations.map((sim) => (
            <option key={sim.simulation_id} value={sim.simulation_id}>
              {sim.simulation_id} ({sim.status})
            </option>
          ))}
        </select>

        <button
          onClick={refreshWorkflow}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
        >
          Refresh
        </button>
      </div>

      <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded">
        <h3 className="font-semibold mb-2">Aerodynamic Optimization Workflow</h3>
        <div className="text-sm text-gray-700">
          <strong>Simulation:</strong> {statePayload.simulation_id || 'n/a'}
        </div>
        <div className="text-sm text-gray-700">
          <strong>Status:</strong> {statePayload.status || 'n/a'}
        </div>
        <div className="text-sm text-gray-700">
          <strong>Duration:</strong> {Number.isFinite(statePayload.duration_s) ? `${statePayload.duration_s.toFixed(2)}s` : 'in-progress'}
        </div>
      </div>

      <div className="space-y-4 mb-6">
        {nodes.map((node, idx) => {
          const meta = statusMeta(node.status);
          const isActive = node.id === currentNode;

          return (
            <div key={node.id}>
              <div className={`p-4 rounded-lg border-2 ${meta.color} ${isActive ? 'ring-2 ring-purple-500' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {meta.icon}
                    <div>
                      <div className="font-semibold">{node.name}</div>
                      <div className="text-xs opacity-75 capitalize">{node.status}</div>
                    </div>
                  </div>
                  {Number.isFinite(node.duration) && (
                    <div className="text-sm">
                      <span className="text-gray-600">Duration:</span>
                      <span className="ml-2 font-mono font-bold">{node.duration.toFixed(2)}s</span>
                    </div>
                  )}
                </div>
              </div>

              {idx < nodes.length - 1 && (
                <div className="flex justify-center my-2">
                  <div className="text-gray-400">↓</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-4 bg-gray-50 rounded border border-gray-200">
        <h3 className="font-semibold mb-3">Current Workflow State</h3>
        <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-80 overflow-y-auto">
          {JSON.stringify(statePayload, null, 2)}
        </pre>
      </div>
    </div>
  );
};

export default WorkflowVisualizer;
