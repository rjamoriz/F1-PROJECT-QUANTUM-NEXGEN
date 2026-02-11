/**
 * System Routes
 * Aggregated health/status endpoint for full-stack operational visibility.
 */

const express = require('express');
const os = require('os');
const axios = require('axios');
const { performance } = require('perf_hooks');
const { createServiceClient, healthCheck } = require('../utils/serviceClient');
const { physics: physicsConfig, ml: mlConfig, quantum: quantumConfig } = require('../config/services');

const router = express.Router();

const physicsClient = createServiceClient(
  'Physics Engine',
  physicsConfig.baseUrl,
  8000
);
const mlClient = createServiceClient(
  'ML Surrogate',
  mlConfig.baseUrl,
  8000
);
const quantumClient = createServiceClient(
  'Quantum Optimizer',
  quantumConfig.baseUrl,
  8000
);

function toSafeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function resolveBackendBaseUrl(req) {
  if (process.env.BACKEND_PUBLIC_URL) {
    return stripTrailingSlash(process.env.BACKEND_PUBLIC_URL);
  }
  if (process.env.BACKEND_SELF_URL) {
    return stripTrailingSlash(process.env.BACKEND_SELF_URL);
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return stripTrailingSlash(`${protocol}://${req.get('host')}`);
}

async function probeService(name, key, client, endpoint, baseUrl) {
  const started = performance.now();
  const health = await healthCheck(client, endpoint);
  const latencyMs = performance.now() - started;

  if (!health.healthy) {
    return {
      name,
      key,
      endpoint: `${baseUrl}${endpoint}`,
      status: 'down',
      healthy: false,
      latency_ms: Number(latencyMs.toFixed(2)),
      details: null,
      error: health.error || 'unavailable',
    };
  }

  const rawStatus =
    typeof health.status === 'string'
      ? health.status
      : health.status?.status || health.status?.service || 'healthy';

  const normalized = ['healthy', 'operational', 'ok'].includes(String(rawStatus).toLowerCase())
    ? 'healthy'
    : 'degraded';

  return {
    name,
    key,
    endpoint: `${baseUrl}${endpoint}`,
    status: normalized,
    healthy: true,
    latency_ms: Number(latencyMs.toFixed(2)),
    details: health.status,
    error: null,
  };
}

router.get('/health', async (req, res) => {
  const backendStart = performance.now();
  const backendBaseUrl = resolveBackendBaseUrl(req);
  const probes = await Promise.all([
    probeService('Backend API', 'backend', {
      get: async () => ({ status: 200, data: { status: 'healthy' } }),
    }, '/health', backendBaseUrl),
    probeService('Physics Engine', 'physics', physicsClient, physicsConfig.endpoints.health, physicsConfig.baseUrl),
    probeService('ML Surrogate', 'ml', mlClient, mlConfig.endpoints.health, mlConfig.baseUrl),
    probeService('Quantum Optimizer', 'quantum', quantumClient, quantumConfig.endpoints.health, quantumConfig.baseUrl),
  ]);

  let mlStats = null;
  try {
    const response = await mlClient.get(mlConfig.endpoints.stats);
    mlStats = response.data;
  } catch (error) {
    mlStats = null;
  }

  let simulationSummary = {
    recent_runs: 0,
    active_jobs: 0,
    status_breakdown: {},
  };
  try {
    const selfBaseUrl = process.env.BACKEND_SELF_URL || `http://127.0.0.1:${process.env.PORT || 3001}`;
    const simulationResponse = await axios.get(`${selfBaseUrl}/api/simulation`, {
      timeout: 5000,
      params: { limit: 30, include_failed: true },
    });
    const simulationData = simulationResponse?.data?.data || {};
    const simulations = Array.isArray(simulationData.simulations) ? simulationData.simulations : [];

    const statusBreakdown = simulations.reduce((acc, simulation) => {
      const status = simulation.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    simulationSummary = {
      recent_runs: simulations.length,
      active_jobs: toSafeNumber(simulationData.active_jobs, 0),
      status_breakdown: statusBreakdown,
    };
  } catch (error) {
    simulationSummary = {
      recent_runs: 0,
      active_jobs: 0,
      status_breakdown: {},
      error: error.message,
    };
  }

  const totalServices = probes.length;
  const healthyServices = probes.filter((service) => service.status === 'healthy').length;
  const degradedServices = probes.filter((service) => service.status === 'degraded').length;
  const downServices = probes.filter((service) => service.status === 'down').length;
  const avgLatency = probes.reduce((sum, service) => sum + toSafeNumber(service.latency_ms, 0), 0) / Math.max(totalServices, 1);
  const availability = totalServices > 0 ? (healthyServices / totalServices) * 100 : 0;

  const memoryUsage = process.memoryUsage();

  const cacheRequests = toSafeNumber(mlStats?.cache?.requests, 0);
  const cacheHits = toSafeNumber(mlStats?.cache?.hits, 0);
  const cacheHitRate = cacheRequests > 0 ? (cacheHits / cacheRequests) * 100 : 0;

  const responsePayload = {
    generated_at: new Date().toISOString(),
    summary: {
      total_services: totalServices,
      healthy_services: healthyServices,
      degraded_services: degradedServices,
      down_services: downServices,
      availability_percent: Number(availability.toFixed(2)),
      avg_latency_ms: Number(avgLatency.toFixed(2)),
      backend_response_ms: Number((performance.now() - backendStart).toFixed(2)),
    },
    services: probes,
    simulation: simulationSummary,
    ml_runtime: {
      mode: mlStats?.mode || null,
      cache: {
        requests: cacheRequests,
        hits: cacheHits,
        hit_rate_percent: Number(cacheHitRate.toFixed(2)),
      },
      predictor: mlStats?.predictor || null,
    },
    resources: {
      process_memory_mb: {
        rss: Number((memoryUsage.rss / (1024 * 1024)).toFixed(2)),
        heap_used: Number((memoryUsage.heapUsed / (1024 * 1024)).toFixed(2)),
        heap_total: Number((memoryUsage.heapTotal / (1024 * 1024)).toFixed(2)),
      },
      cpu: {
        load_avg_1m: Number(toSafeNumber(os.loadavg()?.[0], 0).toFixed(3)),
      },
      gpu: {
        available: false,
        note: 'GPU usage probe is not enabled in backend runtime',
      },
    },
  };

  return res.json({
    success: true,
    data: responsePayload,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
