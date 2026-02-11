/**
 * Job Orchestration Dashboard
 * Tracks coupled simulation jobs using /api/simulation endpoints.
 */

import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import { RotateCcw, X, Clock, CheckCircle, XCircle, AlertCircle } from './lucideShim';

const API_BASE = BACKEND_API_BASE;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toDurationSeconds(started, completed) {
  if (!started || !completed) return null;
  const startMs = new Date(started).getTime();
  const endMs = new Date(completed).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return Math.round((endMs - startMs) / 1000);
}

const JobOrchestrationDashboard = () => {
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created');
  const [error, setError] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 2500);
    return () => clearInterval(interval);
  }, [filter, sortBy]);

  const loadJobs = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/simulation`, {
        params: {
          limit: 60,
          include_failed: true,
        },
      });

      const simulations = response?.data?.data?.simulations || [];
      const mapped = simulations.map((sim) => {
        const baseStatus = sim.status || 'unknown';
        const normalizedStatus = baseStatus === 'degraded' ? 'degraded' : baseStatus;

        return {
          id: sim.simulation_id,
          type: sim.workflow?.quantum === 'completed' ? 'coupled_quantum_cfd' : 'coupled_simulation',
          status: normalizedStatus,
          priority: normalizedStatus === 'failed' ? 'high' : normalizedStatus === 'running' ? 'high' : 'medium',
          progress: Number.isFinite(sim.progress) ? sim.progress : (normalizedStatus === 'completed' ? 100 : 0),
          created: sim.started_at,
          started: sim.started_at,
          completed: sim.completed_at,
          duration: toDurationSeconds(sim.started_at, sim.completed_at),
          parameters: {
            coupling_iterations: sim.coupling_iterations,
            workflow: sim.workflow,
          },
          result: sim.status === 'completed' ? { workflow: sim.workflow } : null,
        };
      });

      setJobs(mapped);
      setError(null);
    } catch (requestError) {
      setError(requestError?.message || 'Failed to fetch simulation jobs');
      setJobs([]);
    }
  };

  const retryJob = async (jobId) => {
    try {
      setActionMessage(null);
      const detailResponse = await axios.get(`${API_BASE}/api/simulation/${jobId}`);
      const simulation = detailResponse?.data?.data;
      if (!simulation) {
        throw new Error('Simulation detail not found for rerun');
      }

      await axios.post(`${API_BASE}/api/simulation/run`, {
        geometry: simulation.geometry,
        conditions: simulation.conditions,
        optimization: simulation?.optimization?.enabled !== false,
        use_quantum: simulation?.optimization?.use_quantum !== false,
        use_ml_surrogate: simulation?.baseline?.ml_surrogate?.source !== 'disabled',
        use_cfd_adapter: simulation?.cfd?.adapter_enabled !== false,
        coupling_iterations: clamp(Number(simulation.coupling_iterations || 4), 1, 20),
        async_mode: true,
        optimization_weights: {
          drag: 1.0,
          lift: 1.0,
          max_nodes: 24,
        },
      });

      setActionMessage(`Rerun submitted for ${jobId}`);
      await loadJobs();
    } catch (requestError) {
      setActionMessage(`Retry failed for ${jobId}: ${requestError?.message || 'unknown error'}`);
    }
  };

  const cancelJob = async (jobId) => {
    setActionMessage(`Cancellation is not implemented for coupled simulation jobs yet (${jobId}).`);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'running':
        return <Clock className="w-5 h-5 text-blue-600 animate-spin" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'degraded':
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      case 'pending':
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'running':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'degraded':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'text-red-600 font-bold';
      case 'medium':
        return 'text-yellow-700 font-semibold';
      case 'low':
        return 'text-gray-600';
      default:
        return 'text-gray-600';
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const formatTime = (isoString) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleTimeString();
  };

  const filteredJobs = useMemo(() => {
    let out = jobs;

    if (filter !== 'all') {
      out = out.filter((job) => job.status === filter);
    }

    if (sortBy === 'priority') {
      const rank = { high: 0, medium: 1, low: 2 };
      out = [...out].sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3));
    } else if (sortBy === 'status') {
      out = [...out].sort((a, b) => String(a.status).localeCompare(String(b.status)));
    } else {
      out = [...out].sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
    }

    return out;
  }, [jobs, filter, sortBy]);

  const stats = {
    total: jobs.length,
    pending: jobs.filter((job) => job.status === 'pending').length,
    running: jobs.filter((job) => job.status === 'running').length,
    completed: jobs.filter((job) => job.status === 'completed').length,
    failed: jobs.filter((job) => ['failed', 'degraded'].includes(job.status)).length,
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Job Orchestration Dashboard</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {String(error)}
        </div>
      )}

      {actionMessage && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
          {String(actionMessage)}
        </div>
      )}

      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="p-4 bg-gray-50 rounded border border-gray-200">
          <div className="text-sm text-gray-600">Total Jobs</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </div>
        <div className="p-4 bg-yellow-50 rounded border border-yellow-200">
          <div className="text-sm text-yellow-700">Pending</div>
          <div className="text-2xl font-bold text-yellow-800">{stats.pending}</div>
        </div>
        <div className="p-4 bg-blue-50 rounded border border-blue-200">
          <div className="text-sm text-blue-700">Running</div>
          <div className="text-2xl font-bold text-blue-800">{stats.running}</div>
        </div>
        <div className="p-4 bg-green-50 rounded border border-green-200">
          <div className="text-sm text-green-700">Completed</div>
          <div className="text-2xl font-bold text-green-800">{stats.completed}</div>
        </div>
        <div className="p-4 bg-red-50 rounded border border-red-200">
          <div className="text-sm text-red-700">Failed/Degraded</div>
          <div className="text-2xl font-bold text-red-800">{stats.failed}</div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-2">
          {['all', 'pending', 'running', 'completed', 'failed', 'degraded'].map((statusKey) => (
            <button
              key={statusKey}
              onClick={() => setFilter(statusKey)}
              className={`px-4 py-2 rounded ${filter === statusKey ? 'bg-purple-600 text-white' : 'bg-gray-200'}`}
            >
              {statusKey}
            </button>
          ))}
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-4 py-2 border rounded"
        >
          <option value="created">Sort by Created</option>
          <option value="priority">Sort by Priority</option>
          <option value="status">Sort by Status</option>
        </select>
      </div>

      <div className="space-y-3">
        {filteredJobs.map((job) => (
          <div
            key={job.id}
            className={`p-4 rounded border ${getStatusColor(job.status)}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  {getStatusIcon(job.status)}
                  <span className="font-semibold text-lg">{job.id}</span>
                  <span className="px-2 py-1 bg-white rounded text-sm">{job.type}</span>
                  <span className={`text-sm ${getPriorityColor(job.priority)}`}>
                    {job.priority.toUpperCase()} PRIORITY
                  </span>
                </div>

                {job.status === 'running' && (
                  <div className="mb-2">
                    <div className="flex justify-between text-sm mb-1">
                      <span>Progress</span>
                      <span>{job.progress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Created:</span>
                    <span className="ml-2 font-medium">{formatTime(job.created)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Started:</span>
                    <span className="ml-2 font-medium">{formatTime(job.started)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Completed:</span>
                    <span className="ml-2 font-medium">{formatTime(job.completed)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Duration:</span>
                    <span className="ml-2 font-medium">{formatDuration(job.duration)}</span>
                  </div>
                </div>

                <div className="mt-2 text-sm">
                  <span className="text-gray-600">Parameters:</span>
                  <span className="ml-2 font-mono text-xs">
                    {JSON.stringify(job.parameters)}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 ml-4">
                {(job.status === 'failed' || job.status === 'degraded' || job.status === 'completed') && (
                  <button
                    onClick={() => retryJob(job.id)}
                    className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    title="Rerun"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
                {(job.status === 'pending' || job.status === 'running') && (
                  <button
                    onClick={() => cancelJob(job.id)}
                    className="p-2 bg-red-600 text-white rounded hover:bg-red-700"
                    title="Cancel (not yet implemented)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredJobs.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No jobs found with status: {filter}
        </div>
      )}
    </div>
  );
};

export default JobOrchestrationDashboard;
