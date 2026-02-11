/**
 * AeroTransformer Dashboard
 * Phase 1 runtime dashboard for ML surrogate contracts
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import {
  Activity,
  BarChart3,
  Brain,
  Database,
  RefreshCw,
  TrendingUp,
  Zap,
} from './lucideShim';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const API_BASE = BACKEND_API_BASE;
const HISTORY_LIMIT = 40;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function unwrapData(response) {
  if (!response || typeof response !== 'object') {
    return null;
  }
  if (response.data && Object.prototype.hasOwnProperty.call(response.data, 'data')) {
    return response.data.data;
  }
  return response.data || null;
}

const AeroTransformerDashboard = () => {
  const [health, setHealth] = useState(null);
  const [runtimeStats, setRuntimeStats] = useState(null);
  const [models, setModels] = useState([]);

  const [predictionInput, setPredictionInput] = useState({
    mesh_id: 'f1_front_wing_baseline',
    velocity: 72,
    alpha: 4.5,
    yaw: 0.5,
    rho: 1.225,
  });
  const [benchmarkIterations, setBenchmarkIterations] = useState(12);

  const [predictionResult, setPredictionResult] = useState(null);
  const [predictionHistory, setPredictionHistory] = useState([]);
  const [benchmarkResults, setBenchmarkResults] = useState(null);

  const [isLoadingRuntime, setIsLoadingRuntime] = useState(false);
  const [isPredicting, setIsPredicting] = useState(false);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const loadRuntime = useCallback(async () => {
    setIsLoadingRuntime(true);
    setErrorMessage(null);

    const [healthResult, modelsResult, statsResult] = await Promise.allSettled([
      axios.get(`${API_BASE}/api/ml/health`),
      axios.get(`${API_BASE}/api/ml/models`),
      axios.get(`${API_BASE}/api/ml/stats`),
    ]);

    if (healthResult.status === 'fulfilled') {
      const payload = healthResult.value?.data || {};
      setHealth(payload);
    }

    if (modelsResult.status === 'fulfilled') {
      const payload = unwrapData(modelsResult.value);
      setModels(Array.isArray(payload) ? payload : []);
    }

    if (statsResult.status === 'fulfilled') {
      const payload = unwrapData(statsResult.value);
      setRuntimeStats(payload || null);
    }

    const failed = [healthResult, modelsResult, statsResult].filter((entry) => entry.status === 'rejected');
    if (failed.length > 0) {
      const firstError = failed[0].reason;
      setErrorMessage(firstError?.message || 'Runtime service refresh failed');
    }

    setIsLoadingRuntime(false);
  }, []);

  useEffect(() => {
    loadRuntime();
    const interval = setInterval(loadRuntime, 8000);
    return () => clearInterval(interval);
  }, [loadRuntime]);

  const runPredictRequest = useCallback(async ({ meshId, useCache }) => {
    const requestPayload = {
      mesh_id: meshId,
      parameters: {
        velocity: safeNumber(predictionInput.velocity, 72),
        alpha: safeNumber(predictionInput.alpha, 4.5),
        yaw: safeNumber(predictionInput.yaw, 0.5),
        rho: safeNumber(predictionInput.rho, 1.225),
      },
      use_cache: useCache,
      return_confidence: true,
    };

    const started = performance.now();
    const response = await axios.post(`${API_BASE}/api/ml/predict`, requestPayload);
    const finished = performance.now();

    const prediction = unwrapData(response) || {};
    const roundTripMs = finished - started;

    return {
      ...prediction,
      mesh_id: meshId,
      round_trip_ms: roundTripMs,
      timestamp: new Date().toISOString(),
      cached: response?.data?.cached ?? prediction.cached ?? false,
    };
  }, [predictionInput]);

  const runPrediction = async (useCache = true) => {
    try {
      setIsPredicting(true);
      setErrorMessage(null);

      const result = await runPredictRequest({
        meshId: predictionInput.mesh_id,
        useCache,
      });

      setPredictionResult(result);
      setPredictionHistory((prev) => [...prev, result].slice(-HISTORY_LIMIT));
      await loadRuntime();
    } catch (error) {
      setErrorMessage(error?.response?.data?.error?.message || error.message || 'Prediction failed');
    } finally {
      setIsPredicting(false);
    }
  };

  const runBenchmark = async () => {
    const totalRuns = clamp(parseInt(benchmarkIterations, 10) || 8, 4, 30);

    try {
      setIsBenchmarking(true);
      setErrorMessage(null);

      const runs = [];
      for (let i = 0; i < totalRuns; i += 1) {
        const meshId = `${predictionInput.mesh_id}_bench_${i + 1}_${Date.now()}`;
        const result = await runPredictRequest({ meshId, useCache: false });
        runs.push(result);
      }

      const roundTrips = runs.map((run) => safeNumber(run.round_trip_ms, 0));
      const inferenceTimes = runs.map((run) => safeNumber(run.inference_time_ms, 0));
      const sorted = [...roundTrips].sort((a, b) => a - b);
      const p95Index = Math.max(0, Math.floor(0.95 * (sorted.length - 1)));
      const meanRoundTrip = roundTrips.reduce((sum, value) => sum + value, 0) / roundTrips.length;
      const meanInference = inferenceTimes.reduce((sum, value) => sum + value, 0) / inferenceTimes.length;

      setBenchmarkResults({
        runs: totalRuns,
        mean_round_trip_ms: meanRoundTrip,
        mean_inference_ms: meanInference,
        min_round_trip_ms: Math.min(...roundTrips),
        max_round_trip_ms: Math.max(...roundTrips),
        p95_round_trip_ms: sorted[p95Index],
        target_met: meanInference < 50,
      });

      setPredictionResult(runs[runs.length - 1]);
      setPredictionHistory((prev) => [...prev, ...runs].slice(-HISTORY_LIMIT));
      await loadRuntime();
    } catch (error) {
      setErrorMessage(error?.response?.data?.error?.message || error.message || 'Benchmark failed');
    } finally {
      setIsBenchmarking(false);
    }
  };

  const clearCache = async () => {
    try {
      setIsClearingCache(true);
      setErrorMessage(null);
      await axios.post(`${API_BASE}/api/ml/cache/clear`, {});
      await loadRuntime();
    } catch (error) {
      setErrorMessage(error?.response?.data?.error?.message || error.message || 'Cache clear failed');
    } finally {
      setIsClearingCache(false);
    }
  };

  const cacheStats = runtimeStats?.cache || {};
  const predictorStats = runtimeStats?.predictor || {};
  const cacheRequests = safeNumber(cacheStats.requests, 0);
  const cacheHits = safeNumber(cacheStats.hits, 0);
  const cacheHitRate = cacheRequests > 0 ? (cacheHits / cacheRequests) * 100 : 0;

  const historySeries = useMemo(() => (
    predictionHistory.map((point, index) => ({
      idx: index + 1,
      round_trip_ms: safeNumber(point.round_trip_ms, 0),
      inference_time_ms: safeNumber(point.inference_time_ms, 0),
      cl: safeNumber(point.cl, 0),
      cd: safeNumber(point.cd, 0),
    }))
  ), [predictionHistory]);

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Brain className="w-6 h-6 text-blue-600" />
        ML Surrogate Runtime Dashboard
      </h2>

      <p className="text-gray-600 mb-6">
        Phase 1 contract view for `/api/ml/*`: runtime health, deterministic inference, cache behavior, and benchmark loop.
      </p>

      {errorMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {String(errorMessage)}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-blue-50 border border-blue-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-blue-600" />
            <span className="text-sm text-blue-700">Service Health</span>
          </div>
          <div className="text-2xl font-bold text-blue-900">{health?.healthy ? 'ONLINE' : 'DEGRADED'}</div>
          <div className="text-xs text-blue-600">{health?.status || runtimeStats?.mode || 'unknown'}</div>
        </div>

        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700">Mean Inference</span>
          </div>
          <div className="text-2xl font-bold text-green-900">{safeNumber(predictorStats.avg_inference_ms, 0).toFixed(2)}ms</div>
          <div className="text-xs text-green-600">{runtimeStats?.mode || 'unknown mode'}</div>
        </div>

        <div className="p-4 bg-purple-50 border border-purple-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-purple-600" />
            <span className="text-sm text-purple-700">Cache Hit Rate</span>
          </div>
          <div className="text-2xl font-bold text-purple-900">{cacheHitRate.toFixed(1)}%</div>
          <div className="text-xs text-purple-600">{cacheHits}/{cacheRequests} hits</div>
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-amber-600" />
            <span className="text-sm text-amber-700">Total Predictions</span>
          </div>
          <div className="text-2xl font-bold text-amber-900">{safeNumber(predictorStats.total_predictions, 0)}</div>
          <div className="text-xs text-amber-600">Recent history: {predictionHistory.length}</div>
        </div>
      </div>

      <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded">
        <h3 className="font-semibold mb-3">Prediction Controls</h3>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-sm">
          <div>
            <label className="block mb-1">Mesh ID</label>
            <input
              type="text"
              value={predictionInput.mesh_id}
              onChange={(e) => setPredictionInput({ ...predictionInput, mesh_id: e.target.value })}
              className="w-full px-2 py-1 border rounded"
            />
          </div>
          <div>
            <label className="block mb-1">Velocity</label>
            <input
              type="number"
              value={predictionInput.velocity}
              onChange={(e) => setPredictionInput({ ...predictionInput, velocity: parseFloat(e.target.value) || 0 })}
              className="w-full px-2 py-1 border rounded"
            />
          </div>
          <div>
            <label className="block mb-1">Alpha</label>
            <input
              type="number"
              step="0.1"
              value={predictionInput.alpha}
              onChange={(e) => setPredictionInput({ ...predictionInput, alpha: parseFloat(e.target.value) || 0 })}
              className="w-full px-2 py-1 border rounded"
            />
          </div>
          <div>
            <label className="block mb-1">Yaw</label>
            <input
              type="number"
              step="0.1"
              value={predictionInput.yaw}
              onChange={(e) => setPredictionInput({ ...predictionInput, yaw: parseFloat(e.target.value) || 0 })}
              className="w-full px-2 py-1 border rounded"
            />
          </div>
          <div>
            <label className="block mb-1">Rho</label>
            <input
              type="number"
              step="0.001"
              value={predictionInput.rho}
              onChange={(e) => setPredictionInput({ ...predictionInput, rho: parseFloat(e.target.value) || 0 })}
              className="w-full px-2 py-1 border rounded"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => runPrediction(true)}
            disabled={isPredicting || isBenchmarking}
            className={`px-4 py-2 rounded text-white ${isPredicting || isBenchmarking ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            Predict (cache on)
          </button>

          <button
            onClick={() => runPrediction(false)}
            disabled={isPredicting || isBenchmarking}
            className={`px-4 py-2 rounded text-white ${isPredicting || isBenchmarking ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
          >
            Predict (cache off)
          </button>

          <div className="flex items-center gap-2 border rounded px-2 py-1 bg-white">
            <span className="text-sm">Benchmark runs</span>
            <input
              type="number"
              min="4"
              max="30"
              value={benchmarkIterations}
              onChange={(e) => setBenchmarkIterations(clamp(parseInt(e.target.value, 10) || 4, 4, 30))}
              className="w-16 px-2 py-1 border rounded"
            />
          </div>

          <button
            onClick={runBenchmark}
            disabled={isBenchmarking || isPredicting}
            className={`px-4 py-2 rounded text-white ${isBenchmarking || isPredicting ? 'bg-gray-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'}`}
          >
            {isBenchmarking ? 'Benchmarking...' : 'Run Benchmark'}
          </button>

          <button
            onClick={clearCache}
            disabled={isClearingCache || isPredicting || isBenchmarking}
            className={`px-4 py-2 rounded text-white ${isClearingCache || isPredicting || isBenchmarking ? 'bg-gray-400 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700'}`}
          >
            {isClearingCache ? 'Clearing...' : 'Clear Cache'}
          </button>

          <button
            onClick={loadRuntime}
            disabled={isLoadingRuntime}
            className={`px-4 py-2 rounded border ${isLoadingRuntime ? 'bg-gray-100 text-gray-400 border-gray-200' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}
          >
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="w-4 h-4" />
              Refresh
            </span>
          </button>
        </div>
      </div>

      {predictionResult && (
        <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded">
          <h3 className="font-semibold mb-3">Latest Prediction</h3>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">Mesh</div>
              <div className="font-medium truncate">{predictionResult.mesh_id}</div>
            </div>
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">CL</div>
              <div className="font-bold text-blue-700">{safeNumber(predictionResult.cl, 0).toFixed(4)}</div>
            </div>
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">CD</div>
              <div className="font-bold text-red-700">{safeNumber(predictionResult.cd, 0).toFixed(4)}</div>
            </div>
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">L/D</div>
              <div className="font-bold text-green-700">
                {(safeNumber(predictionResult.cl, 0) / Math.max(safeNumber(predictionResult.cd, 1e-6), 1e-6)).toFixed(3)}
              </div>
            </div>
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">Inference</div>
              <div className="font-bold">{safeNumber(predictionResult.inference_time_ms, 0).toFixed(3)}ms</div>
            </div>
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">Round Trip</div>
              <div className="font-bold">{safeNumber(predictionResult.round_trip_ms, 0).toFixed(3)}ms</div>
            </div>
          </div>
        </div>
      )}

      {historySeries.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Prediction Timing History
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={historySeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="idx" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="round_trip_ms" stroke="#2563eb" strokeWidth={2} dot={false} name="Round trip ms" />
              <Line yAxisId="left" type="monotone" dataKey="inference_time_ms" stroke="#16a34a" strokeWidth={2} dot={false} name="Inference ms" />
              <Line yAxisId="right" type="monotone" dataKey="cl" stroke="#7c3aed" strokeWidth={2} dot={false} name="CL" />
              <Line yAxisId="right" type="monotone" dataKey="cd" stroke="#dc2626" strokeWidth={2} dot={false} name="CD" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {benchmarkResults && (
        <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded">
          <h3 className="font-semibold mb-3">Benchmark Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">Runs</div>
              <div className="font-bold">{benchmarkResults.runs}</div>
            </div>
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">Mean Round Trip</div>
              <div className="font-bold">{benchmarkResults.mean_round_trip_ms.toFixed(3)}ms</div>
            </div>
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">Mean Inference</div>
              <div className="font-bold">{benchmarkResults.mean_inference_ms.toFixed(3)}ms</div>
            </div>
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">P95 Round Trip</div>
              <div className="font-bold">{benchmarkResults.p95_round_trip_ms.toFixed(3)}ms</div>
            </div>
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">Min</div>
              <div className="font-bold">{benchmarkResults.min_round_trip_ms.toFixed(3)}ms</div>
            </div>
            <div className="p-2 bg-white border rounded">
              <div className="text-xs text-gray-500">Max</div>
              <div className="font-bold">{benchmarkResults.max_round_trip_ms.toFixed(3)}ms</div>
            </div>
          </div>

          <div className={`mt-3 p-3 rounded text-sm font-medium ${benchmarkResults.target_met ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {benchmarkResults.target_met
              ? 'Inference target met: mean inference < 50ms'
              : 'Inference target not met: tune model/hardware before race-critical runs'}
          </div>
        </div>
      )}

      <div className="p-4 bg-gray-50 border border-gray-200 rounded">
        <h3 className="font-semibold mb-3">Active Models</h3>
        <div className="space-y-2">
          {models.length === 0 && (
            <div className="text-sm text-gray-500">No model metadata available.</div>
          )}
          {models.map((model) => (
            <div key={`${model.name}-${model.device}`} className="p-3 bg-white border rounded text-sm flex justify-between gap-3">
              <div>
                <div className="font-medium">{model.name}</div>
                <div className="text-gray-600">
                  {model.type} | params: {model.parameters} | input: [{(model.input_shape || []).join(', ')}] | output: [{(model.output_shape || []).join(', ')}]
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">{model.device}</div>
                <div className="text-xs text-gray-500">{model.status}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AeroTransformerDashboard;
