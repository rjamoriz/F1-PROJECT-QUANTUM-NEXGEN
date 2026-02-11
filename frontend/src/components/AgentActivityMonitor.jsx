/**
 * Agent Activity Monitor
 * Live coordination status derived from local orchestrator + simulation workflow.
 */

import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import { Bot, Activity, Clock, AlertCircle } from './lucideShim';

const API_BASE = BACKEND_API_BASE;

function toSafeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function stageActive(stageValue) {
  const normalized = String(stageValue || '').toLowerCase();
  return normalized === 'running' || normalized === 'pending' || normalized === 'degraded';
}

function latestTimestampFromSimulations(simulations = []) {
  const stamps = simulations
    .map((sim) => sim.completed_at || sim.started_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (stamps.length === 0) {
    return new Date();
  }

  return new Date(Math.max(...stamps));
}

const AgentActivityMonitor = () => {
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAgentStatus();
    const interval = setInterval(loadAgentStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const loadAgentStatus = async () => {
    try {
      const [agentResponse, simulationsResponse, systemHealthResponse] = await Promise.all([
        axios.get(`${API_BASE}/api/claude/agents`),
        axios.get(`${API_BASE}/api/simulation`, {
          params: { limit: 40, include_failed: true },
        }),
        axios.get(`${API_BASE}/api/system/health`),
      ]);

      const rawAgents = agentResponse?.data?.data?.agents || [];
      const simulations = simulationsResponse?.data?.data?.simulations || [];
      const systemServices = systemHealthResponse?.data?.data?.services || [];

      const runningSim = simulations.find((sim) => sim.status === 'running') || null;
      const completedCount = simulations.filter((sim) => sim.status === 'completed').length;
      const failedCount = simulations.filter((sim) => sim.status === 'failed' || sim.status === 'degraded').length;
      const latestStamp = latestTimestampFromSimulations(simulations);

      const serviceLatencyByKey = {};
      systemServices.forEach((service) => {
        serviceLatencyByKey[service.key] = toSafeNumber(service.latency_ms, 0) / 1000;
      });

      const mapped = rawAgents.map((agentDef) => {
        const id = agentDef.name;
        const workflow = runningSim?.workflow || {};

        let status = 'idle';
        let currentTask = null;

        if (id === 'master_orchestrator') {
          status = runningSim ? 'active' : 'idle';
          currentTask = runningSim ? `Coordinating ${runningSim.simulation_id}` : null;
        } else if (id === 'physics_validator') {
          status = stageActive(workflow.physics) ? 'active' : 'idle';
          currentTask = status === 'active' ? 'Validating VLM and baseline physics' : null;
        } else if (id === 'ml_surrogate') {
          status = stageActive(workflow.ml) ? 'active' : 'idle';
          currentTask = status === 'active' ? 'Serving surrogate aero predictions' : null;
        } else if (id === 'quantum_optimizer') {
          status = stageActive(workflow.quantum) ? 'active' : 'idle';
          currentTask = status === 'active' ? 'Solving node-level QUBO selection' : null;
        } else if (id === 'analysis') {
          const inAnalysis = runningSim && !stageActive(workflow.quantum) && stageActive(workflow.cfd_proxy);
          status = inAnalysis ? 'active' : 'idle';
          currentTask = status === 'active' ? 'Summarizing coupled CFD and optimization deltas' : null;
        }

        const serviceKey =
          id === 'physics_validator' ? 'physics'
            : id === 'ml_surrogate' ? 'ml'
              : id === 'quantum_optimizer' ? 'quantum'
                : 'backend';

        const avgResponseTime = serviceLatencyByKey[serviceKey] || (status === 'active' ? 1.2 : 0.8);

        return {
          name: id
            .split('_')
            .map((word) => word[0].toUpperCase() + word.slice(1))
            .join(' '),
          model: agentDef.model,
          status,
          tasksCompleted: completedCount,
          failedTasks: failedCount,
          avgResponseTime,
          currentTask,
          lastActive: status === 'active' ? new Date() : latestStamp,
        };
      });

      setAgents(mapped);
      setError(null);
    } catch (requestError) {
      setError(requestError?.message || 'Failed to load agent activity');
      setAgents([]);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 border-green-300 text-green-800';
      case 'idle':
        return 'bg-gray-100 border-gray-300 text-gray-700';
      case 'error':
        return 'bg-red-100 border-red-300 text-red-800';
      default:
        return 'bg-gray-100 border-gray-300 text-gray-700';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active':
        return <Activity className="w-5 h-5 text-green-600 animate-pulse" />;
      case 'idle':
        return <Clock className="w-5 h-5 text-gray-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Bot className="w-5 h-5 text-gray-500" />;
    }
  };

  const activeAgents = agents.filter((agent) => agent.status === 'active').length;
  const totalTasks = agents.reduce((sum, agent) => sum + toSafeNumber(agent.tasksCompleted, 0), 0);
  const avgResponse = agents.length > 0
    ? agents.reduce((sum, agent) => sum + toSafeNumber(agent.avgResponseTime, 0), 0) / agents.length
    : 0;

  const latestActiveSeconds = useMemo(() => {
    const latest = agents
      .map((agent) => new Date(agent.lastActive).getTime())
      .filter((value) => Number.isFinite(value));

    if (latest.length === 0) {
      return null;
    }

    return Math.max(0, Math.floor((Date.now() - Math.max(...latest)) / 1000));
  }, [agents]);

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Bot className="w-6 h-6" />
        Agent Activity Monitor
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {String(error)}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <div className="text-sm text-green-700">Active Agents</div>
          <div className="text-3xl font-bold text-green-900">{activeAgents}/{agents.length}</div>
        </div>
        <div className="p-4 bg-blue-50 border border-blue-200 rounded">
          <div className="text-sm text-blue-700">Total Tasks (Completed)</div>
          <div className="text-3xl font-bold text-blue-900">{totalTasks}</div>
        </div>
        <div className="p-4 bg-purple-50 border border-purple-200 rounded">
          <div className="text-sm text-purple-700">Avg Response</div>
          <div className="text-3xl font-bold text-purple-900">{avgResponse.toFixed(2)}s</div>
        </div>
        <div className="p-4 bg-amber-50 border border-amber-200 rounded">
          <div className="text-sm text-amber-700">Last Activity</div>
          <div className="text-3xl font-bold text-amber-900">
            {latestActiveSeconds === null ? 'n/a' : `${latestActiveSeconds}s`}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {agents.map((agent) => (
          <div
            key={agent.name}
            className={`p-4 rounded-lg border-2 ${getStatusColor(agent.status)}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {getStatusIcon(agent.status)}
                <div>
                  <div className="font-semibold text-lg">{agent.name}</div>
                  <div className="text-sm opacity-75">{agent.model}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs opacity-75">Status</div>
                <div className="font-semibold capitalize">{agent.status}</div>
              </div>
            </div>

            {agent.currentTask && (
              <div className="mt-3 p-2 bg-white rounded text-sm">
                <strong>Current Task:</strong> {agent.currentTask}
              </div>
            )}

            <div className="grid grid-cols-4 gap-4 mt-3 text-sm">
              <div>
                <div className="text-xs opacity-75">Tasks Completed</div>
                <div className="font-semibold">{agent.tasksCompleted}</div>
              </div>
              <div>
                <div className="text-xs opacity-75">Failed Runs</div>
                <div className="font-semibold">{agent.failedTasks}</div>
              </div>
              <div>
                <div className="text-xs opacity-75">Avg Response</div>
                <div className="font-semibold">{agent.avgResponseTime.toFixed(2)}s</div>
              </div>
              <div>
                <div className="text-xs opacity-75">Last Active</div>
                <div className="font-semibold">
                  {Math.floor((Date.now() - new Date(agent.lastActive).getTime()) / 1000)}s ago
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {agents.length === 0 && (
        <div className="text-center py-10 text-gray-500">No agent telemetry available.</div>
      )}
    </div>
  );
};

export default AgentActivityMonitor;
