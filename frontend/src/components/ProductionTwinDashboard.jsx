/**
 * Production Twin Dashboard (Phase 4)
 * Telemetry loop + digital twin state contracts with websocket streaming.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE, backendWsUrl } from '../config/endpoints';
import { Activity, RefreshCw, Waves } from './lucideShim';
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
const TELEMETRY_MAX_POINTS = 400;

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function compactIsoTime(isoValue) {
  if (!isoValue) return '';
  const parsed = new Date(isoValue);
  if (!Number.isFinite(parsed.getTime())) return '';
  return parsed.toISOString().slice(11, 19);
}

function createRandomTelemetry(lastPoint = null) {
  const speed = toSafeNumber(lastPoint?.speed_kph, 305) + (Math.random() - 0.5) * 12;
  const drag = toSafeNumber(lastPoint?.drag_n, 1240) + (Math.random() - 0.5) * 60;
  const downforce = toSafeNumber(lastPoint?.downforce_n, 4380) + (Math.random() - 0.5) * 180;
  const yaw = toSafeNumber(lastPoint?.yaw_deg, 0.6) + (Math.random() - 0.5) * 0.35;

  return {
    speed_kph: Number(speed.toFixed(3)),
    drag_n: Number(Math.max(drag, 800).toFixed(3)),
    downforce_n: Number(Math.max(downforce, 2500).toFixed(3)),
    yaw_deg: Number(yaw.toFixed(4)),
    battery_soc: Number(Math.max(15, 62 + (Math.random() - 0.5) * 3).toFixed(3)),
    ers_deploy_kw: Number((215 + (Math.random() - 0.5) * 40).toFixed(3)),
    drs_open: speed > 300 && Math.abs(yaw) < 1.3,
    sector: [1, 2, 3][Math.floor(Math.random() * 3)],
  };
}

function normalizeIncomingPoint(point) {
  return {
    telemetry_id: String(point?.telemetry_id || ''),
    car_id: String(point?.car_id || 'car-44'),
    timestamp: point?.timestamp || new Date().toISOString(),
    speed_kph: toSafeNumber(point?.speed_kph, 0),
    downforce_n: toSafeNumber(point?.downforce_n, 0),
    drag_n: toSafeNumber(point?.drag_n, 0),
    yaw_deg: toSafeNumber(point?.yaw_deg, 0),
    battery_soc: toSafeNumber(point?.battery_soc, 0),
    drs_open: Boolean(point?.drs_open),
    anomalies: Array.isArray(point?.anomalies) ? point.anomalies : [],
  };
}

function resolveAuthToken() {
  try {
    return localStorage.getItem('auth_token') || '';
  } catch (_error) {
    return '';
  }
}

const ProductionTwinDashboard = () => {
  const [carId, setCarId] = useState('car-44');
  const [telemetryData, setTelemetryData] = useState(null);
  const [twinData, setTwinData] = useState(null);
  const [fleetSummary, setFleetSummary] = useState(null);
  const [streamStatus, setStreamStatus] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isStreamConnected, setIsStreamConnected] = useState(false);
  const [error, setError] = useState(null);

  const streamRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const manualCloseRef = useRef(false);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [recentResponse, twinResponse, summaryResponse, streamResponse] = await Promise.all([
        axios.get(`${API_BASE}/api/evolution/production/telemetry/recent`, {
          params: { car_id: carId, limit: 80, fallback: true },
        }),
        axios.get(`${API_BASE}/api/evolution/production/digital-twin/state`, {
          params: { car_id: carId },
        }),
        axios.get(`${API_BASE}/api/evolution/production/telemetry/summary`, {
          params: {
            car_ids: carId,
            limit_per_car: 120,
            fallback: true,
          },
        }),
        axios.get(`${API_BASE}/api/evolution/production/stream/status`),
      ]);

      setTelemetryData(recentResponse?.data?.data || null);
      setTwinData(twinResponse?.data?.data || null);
      setFleetSummary(summaryResponse?.data?.data || null);
      setStreamStatus(streamResponse?.data?.data || null);
      setError(null);
    } catch (requestError) {
      setError(requestError?.message || 'Failed to refresh production telemetry state');
    } finally {
      setIsRefreshing(false);
    }
  }, [carId]);

  const subscribeToCar = useCallback(() => {
    const socket = streamRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({
      command: 'subscribe',
      car_id: carId,
      channels: ['telemetry', 'digital_twin'],
    }));
  }, [carId]);

  const connectStream = useCallback(() => {
    if (streamRef.current && streamRef.current.readyState <= WebSocket.OPEN) {
      try {
        streamRef.current.close();
      } catch (_error) {
        // no-op
      }
    }

    const token = resolveAuthToken();
    const baseUrl = backendWsUrl('/ws/evolution');
    const wsUrl = token
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
      : baseUrl;
    const socket = new WebSocket(wsUrl);
    streamRef.current = socket;

    socket.onopen = () => {
      setIsStreamConnected(true);
      subscribeToCar();
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data || '{}'));
        const type = String(payload.type || '');
        const data = payload.data || {};

        if (type === 'telemetry_update') {
          if (String(data.car_id || '') !== carId) return;
          const point = normalizeIncomingPoint(data.point);

          setTelemetryData((prev) => {
            const previousPoints = Array.isArray(prev?.points) ? prev.points : [];
            const updatedPoints = [...previousPoints, point];
            const deduped = Array.from(new Map(updatedPoints.map((item) => [item.telemetry_id || `${item.timestamp}-${item.speed_kph}`, item])).values());
            const clipped = deduped.slice(-TELEMETRY_MAX_POINTS);

            return {
              ...(prev || {}),
              car_id: carId,
              total_points: toSafeNumber(data.total_points, clipped.length),
              points: clipped,
              summary: data.summary || prev?.summary || null,
            };
          });
          return;
        }

        if (type === 'digital_twin_update') {
          if (String(data.car_id || '') !== carId) return;
          setTwinData(data.twin || null);
          return;
        }

        if (type === 'stream_error') {
          const code = String(data.code || '');
          if (code === 'UNAUTHORIZED') {
            setError('WebSocket authentication failed. Please log in to enable live stream updates.');
          } else if (code === 'FORBIDDEN') {
            setError(`Subscription rejected: ${String(data.message || 'forbidden')}`);
          } else if (code === 'RATE_LIMITED') {
            setError('WebSocket command rate limited. Slow down subscription updates.');
          } else {
            setError(`Evolution stream error: ${String(data.message || 'unknown')}`);
          }
          return;
        }

        if (type === 'heartbeat') {
          setStreamStatus((prev) => ({
            ...(prev || {}),
            connected_clients: toSafeNumber(data.connected_clients, prev?.connected_clients || 0),
          }));
        }
      } catch (streamError) {
        setError(streamError?.message || 'Failed to parse stream update');
      }
    };

    socket.onclose = () => {
      setIsStreamConnected(false);
      if (manualCloseRef.current) {
        return;
      }
      reconnectTimerRef.current = setTimeout(() => {
        connectStream();
      }, 2500);
    };

    socket.onerror = () => {
      setIsStreamConnected(false);
    };
  }, [carId, subscribeToCar]);

  useEffect(() => {
    manualCloseRef.current = false;
    connectStream();

    return () => {
      manualCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (streamRef.current) {
        try {
          streamRef.current.close();
        } catch (_error) {
          // no-op
        }
      }
    };
  }, [connectStream]);

  useEffect(() => {
    refreshAll();
  }, [carId, refreshAll]);

  useEffect(() => {
    // Reduced polling: only fallback refresh if websocket stream is down.
    const interval = setInterval(() => {
      if (!isStreamConnected) {
        refreshAll();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isStreamConnected, refreshAll]);

  useEffect(() => {
    subscribeToCar();
  }, [subscribeToCar]);

  const ingestSyntheticPoint = async () => {
    setIsIngesting(true);
    try {
      const points = Array.isArray(telemetryData?.points) ? telemetryData.points : [];
      const latest = points[points.length - 1] || null;
      const payload = createRandomTelemetry(latest);
      await axios.post(`${API_BASE}/api/evolution/production/telemetry/ingest`, {
        car_id: carId,
        ...payload,
      });
      // Streaming path should update state. Keep one manual refresh fallback.
      if (!isStreamConnected) {
        await refreshAll();
      }
      setError(null);
    } catch (requestError) {
      setError(requestError?.message || 'Failed to ingest telemetry point');
    } finally {
      setIsIngesting(false);
    }
  };

  const chartData = useMemo(() => {
    const points = Array.isArray(telemetryData?.points) ? telemetryData.points : [];
    return points.map((point) => ({
      t: compactIsoTime(point.timestamp),
      speed: toSafeNumber(point.speed_kph, 0),
      downforce: toSafeNumber(point.downforce_n, 0),
      drag: toSafeNumber(point.drag_n, 0),
      efficiency: toSafeNumber(point.downforce_n, 0) / Math.max(toSafeNumber(point.drag_n, 0), 1e-6),
    }));
  }, [telemetryData]);

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Waves className="w-6 h-6 text-blue-600" />
        Production Digital Twin (Phase 4)
      </h2>

      <p className="text-gray-600 mb-6">
        Ingest telemetry points, monitor live feedback-loop metrics, and view digital twin recommendations fused with simulation Pareto context.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium flex items-center gap-2">
          Car ID
          <input
            type="text"
            value={carId}
            onChange={(event) => setCarId(event.target.value)}
            className="px-3 py-2 border rounded text-sm"
          />
        </label>

        <div className="px-3 py-2 text-xs rounded border bg-white">
          Stream: <span className={isStreamConnected ? 'text-green-700 font-semibold' : 'text-amber-700 font-semibold'}>
            {isStreamConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <div className="px-3 py-2 text-xs rounded border bg-white">
          Clients: <span className="font-semibold">{toSafeNumber(streamStatus?.connected_clients, 0)}</span>
        </div>

        <button
          onClick={refreshAll}
          disabled={isRefreshing}
          className={`px-4 py-2 rounded text-sm flex items-center gap-2 ${
            isRefreshing ? 'bg-gray-400 cursor-not-allowed text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          <RefreshCw className="w-4 h-4" />
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>

        <button
          onClick={ingestSyntheticPoint}
          disabled={isIngesting}
          className={`px-4 py-2 rounded text-sm flex items-center gap-2 ${
            isIngesting ? 'bg-gray-400 cursor-not-allowed text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
          }`}
        >
          <Activity className="w-4 h-4" />
          {isIngesting ? 'Ingesting...' : 'Inject Telemetry Point'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-sm">
        <div className="p-3 border border-gray-200 rounded bg-gray-50">
          <strong>Telemetry Points:</strong> {toSafeNumber(telemetryData?.summary?.count, 0)}
        </div>
        <div className="p-3 border border-gray-200 rounded bg-gray-50">
          <strong>Avg Speed:</strong> {toSafeNumber(telemetryData?.summary?.avg_speed_kph, 0).toFixed(2)} kph
        </div>
        <div className="p-3 border border-gray-200 rounded bg-gray-50">
          <strong>Avg Efficiency:</strong> {toSafeNumber(telemetryData?.summary?.avg_efficiency, 0).toFixed(3)}
        </div>
      </div>

      {fleetSummary?.fleet_summary && (
        <div className="mb-6 p-4 border border-gray-200 rounded bg-white text-sm">
          <h3 className="font-semibold mb-2">Fleet Summary</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="p-2 bg-gray-50 rounded border">
              <strong>Cars:</strong> {toSafeNumber(fleetSummary?.fleet_summary?.cars_monitored, 0)}
            </div>
            <div className="p-2 bg-gray-50 rounded border">
              <strong>Window Points:</strong> {toSafeNumber(fleetSummary?.fleet_summary?.total_window_points, 0)}
            </div>
            <div className="p-2 bg-gray-50 rounded border">
              <strong>Peak Speed:</strong> {toSafeNumber(fleetSummary?.fleet_summary?.peak_speed_kph, 0).toFixed(2)} kph
            </div>
            <div className="p-2 bg-gray-50 rounded border">
              <strong>Anomalies:</strong> {toSafeNumber(fleetSummary?.fleet_summary?.anomaly_count, 0)}
            </div>
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="mb-6 p-4 border border-gray-200 rounded bg-white">
          <h3 className="font-semibold mb-3">Telemetry Trend Window</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="speed" stroke="#2563eb" dot={false} name="Speed (kph)" />
              <Line yAxisId="right" type="monotone" dataKey="efficiency" stroke="#16a34a" dot={false} name="Aero Efficiency" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {twinData && (
        <div className="p-4 border border-indigo-200 bg-indigo-50 rounded">
          <h3 className="font-semibold mb-3">Digital Twin State</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-white rounded border">
              <div><strong>Speed:</strong> {toSafeNumber(twinData?.state?.speed_kph, 0).toFixed(2)} kph</div>
              <div><strong>Downforce:</strong> {toSafeNumber(twinData?.state?.downforce_n, 0).toFixed(1)} N</div>
              <div><strong>Drag:</strong> {toSafeNumber(twinData?.state?.drag_n, 0).toFixed(1)} N</div>
              <div><strong>Stability:</strong> {toSafeNumber(twinData?.state?.stability_index, 0).toFixed(3)}</div>
            </div>
            <div className="p-3 bg-white rounded border">
              <div><strong>Pareto Points:</strong> {toSafeNumber(twinData?.optimization_context?.pareto_points, 0)}</div>
              <div><strong>Target Cl:</strong> {toSafeNumber(twinData?.optimization_context?.target_cl, 0).toFixed(3)}</div>
              <div><strong>Target Cd:</strong> {toSafeNumber(twinData?.optimization_context?.target_cd, 0).toFixed(3)}</div>
              <div><strong>Target Source:</strong> {String(twinData?.optimization_context?.source || 'n/a')}</div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-white rounded border text-sm">
            <strong>Recommended Action:</strong>{' '}
            DRS {twinData?.recommendations?.drs_open ? 'OPEN' : 'CLOSED'}, flap {toSafeNumber(twinData?.recommendations?.flap_angle_deg, 0).toFixed(2)}°
            , expected lap delta {toSafeNumber(twinData?.recommendations?.expected_lap_delta_ms, 0).toFixed(2)} ms
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionTwinDashboard;
