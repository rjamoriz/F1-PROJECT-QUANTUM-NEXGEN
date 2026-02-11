/**
 * System Health Dashboard
 * Live operational health view wired to backend /api/system/health
 */

import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import { Activity, Cpu, Database, Zap, Server, AlertCircle, CheckCircle } from './lucideShim';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE = BACKEND_API_BASE;

const SystemHealthDashboard = () => {
  const [snapshot, setSnapshot] = useState(null);
  const [metrics, setMetrics] = useState({
    availability: [],
    latency: [],
    cacheHit: [],
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    loadSystemHealth();
    const interval = setInterval(loadSystemHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadSystemHealth = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/system/health`);
      const data = response?.data?.data;
      if (!data) {
        throw new Error('Invalid system health response');
      }

      setSnapshot(data);
      setError(null);

      const timestamp = new Date(data.generated_at || Date.now()).toLocaleTimeString();
      setMetrics((prev) => ({
        availability: [
          ...prev.availability,
          { time: timestamp, value: Number(data.summary?.availability_percent || 0) },
        ].slice(-30),
        latency: [
          ...prev.latency,
          { time: timestamp, value: Number(data.summary?.avg_latency_ms || 0) },
        ].slice(-30),
        cacheHit: [
          ...prev.cacheHit,
          { time: timestamp, value: Number(data.ml_runtime?.cache?.hit_rate_percent || 0) },
        ].slice(-30),
      }));
    } catch (requestError) {
      setError(requestError?.message || 'System health fetch failed');
    }
  };

  const services = snapshot?.services || [];
  const summary = snapshot?.summary || {};
  const simulation = snapshot?.simulation || {};
  const resources = snapshot?.resources || {};
  const mlRuntime = snapshot?.ml_runtime || {};

  const totalServices = Number(summary.total_services || services.length || 0);
  const healthyServices = Number(summary.healthy_services || services.filter((service) => service.status === 'healthy').length);
  const degradedServices = Number(summary.degraded_services || services.filter((service) => service.status === 'degraded').length);
  const downServices = Number(summary.down_services || services.filter((service) => service.status === 'down').length);
  const availability = Number(summary.availability_percent || 0);
  const avgLatency = Number(summary.avg_latency_ms || 0);
  const activeJobs = Number(simulation.active_jobs || 0);
  const recentRuns = Number(simulation.recent_runs || 0);
  const cacheHitRate = Number(mlRuntime?.cache?.hit_rate_percent || 0);

  const alerts = useMemo(() => {
    const out = [];

    if (downServices > 0) {
      out.push(`Critical: ${downServices} service(s) are down.`);
    }
    if (degradedServices > 0) {
      out.push(`Warning: ${degradedServices} service(s) are degraded.`);
    }
    if (avgLatency > 1200) {
      out.push(`High average service latency detected (${avgLatency.toFixed(0)}ms).`);
    }
    if (availability < 80) {
      out.push(`Service availability below target (${availability.toFixed(1)}%).`);
    }
    if (activeJobs > 8) {
      out.push(`High simulation concurrency (${activeJobs} active jobs).`);
    }

    return out;
  }, [downServices, degradedServices, avgLatency, availability, activeJobs]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-100 border-green-300 text-green-800';
      case 'degraded':
        return 'bg-yellow-100 border-yellow-300 text-yellow-800';
      case 'down':
        return 'bg-red-100 border-red-300 text-red-800';
      default:
        return 'bg-gray-100 border-gray-300 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'degraded':
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      case 'down':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Activity className="w-5 h-5 text-gray-600" />;
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Activity className="w-6 h-6" />
        System Health Dashboard
      </h2>

      <p className="text-gray-600 mb-6">
        Live telemetry from backend `/api/system/health` with service readiness, runtime latency, and simulation workload.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {String(error)}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <Server className="w-5 h-5 text-green-600" />
            <span className="text-sm text-green-700">Services Healthy</span>
          </div>
          <div className="text-3xl font-bold text-green-900">{healthyServices}/{totalServices}</div>
          <div className="text-xs text-green-700">Degraded: {degradedServices} | Down: {downServices}</div>
        </div>

        <div className="p-4 bg-blue-50 border border-blue-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-5 h-5 text-blue-600" />
            <span className="text-sm text-blue-700">Avg Latency</span>
          </div>
          <div className="text-3xl font-bold text-blue-900">{avgLatency.toFixed(0)}ms</div>
          <div className="text-xs text-blue-700">Backend response: {Number(summary.backend_response_ms || 0).toFixed(1)}ms</div>
        </div>

        <div className="p-4 bg-purple-50 border border-purple-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-5 h-5 text-purple-600" />
            <span className="text-sm text-purple-700">Simulation Runs</span>
          </div>
          <div className="text-3xl font-bold text-purple-900">{recentRuns}</div>
          <div className="text-xs text-purple-700">Active jobs: {activeJobs}</div>
        </div>

        <div className="p-4 bg-cyan-50 border border-cyan-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-5 h-5 text-cyan-600" />
            <span className="text-sm text-cyan-700">ML Cache Hit</span>
          </div>
          <div className="text-3xl font-bold text-cyan-900">{cacheHitRate.toFixed(1)}%</div>
          <div className="text-xs text-cyan-700">Mode: {mlRuntime.mode || 'unknown'}</div>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="font-semibold mb-3">Service Status</h3>
        <div className="space-y-3">
          {services.map((service) => (
            <div
              key={service.key}
              className={`p-4 rounded border-2 ${getStatusColor(service.status)}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(service.status)}
                  <div>
                    <div className="font-semibold">{service.name}</div>
                    <div className="text-xs opacity-75">{service.endpoint}</div>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-xs opacity-75">Latency</div>
                  <div className="font-semibold">{Number(service.latency_ms || 0).toFixed(2)}ms</div>
                </div>
              </div>

              {service.error && (
                <div className="mt-2 p-2 bg-white/80 border rounded text-sm">
                  <strong>Error:</strong> {service.error}
                </div>
              )}
            </div>
          ))}

          {services.length === 0 && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600">
              No service data available yet.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-gray-50 rounded border border-gray-200">
          <h4 className="font-semibold mb-2">Availability %</h4>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={metrics.availability}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" hide />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="p-4 bg-gray-50 rounded border border-gray-200">
          <h4 className="font-semibold mb-2">Average Latency (ms)</h4>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={metrics.latency}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" hide />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="p-4 bg-gray-50 rounded border border-gray-200">
          <h4 className="font-semibold mb-2">ML Cache Hit Rate %</h4>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={metrics.cacheHit}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" hide />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded text-sm">
        <h3 className="font-semibold mb-2">Runtime Resources</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-2 bg-white border rounded">
            Process RSS: <strong>{Number(resources?.process_memory_mb?.rss || 0).toFixed(2)} MB</strong>
          </div>
          <div className="p-2 bg-white border rounded">
            Heap Used: <strong>{Number(resources?.process_memory_mb?.heap_used || 0).toFixed(2)} MB</strong>
          </div>
          <div className="p-2 bg-white border rounded">
            Load Avg (1m): <strong>{Number(resources?.cpu?.load_avg_1m || 0).toFixed(3)}</strong>
          </div>
        </div>
      </div>

      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-yellow-600" />
          System Alerts
        </h3>
        <div className="space-y-2 text-sm">
          {alerts.map((alert, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="text-yellow-700">•</span>
              <p>{alert}</p>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="flex items-start gap-2">
              <span className="text-green-600">✓</span>
              <p>All monitored service indicators are within target bounds.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SystemHealthDashboard;
