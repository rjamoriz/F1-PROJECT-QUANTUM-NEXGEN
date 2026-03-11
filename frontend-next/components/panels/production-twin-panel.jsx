'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import MetricCard from '@/components/ui/metric-card';
import { getJson, postJson } from '@/lib/api-client';
import { backendWsUrl } from '@/lib/endpoints';
import { num, since } from '@/lib/format';
import { useAuth } from '@/components/auth/auth-provider';

const TELEMETRY_MAX_POINTS = 320;

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

function normalizePoint(point = {}) {
  return {
    telemetry_id: String(point.telemetry_id || `${point.timestamp || Date.now()}`),
    car_id: String(point.car_id || 'car-44'),
    timestamp: point.timestamp || new Date().toISOString(),
    speed_kph: toSafeNumber(point.speed_kph, 0),
    downforce_n: toSafeNumber(point.downforce_n, 0),
    drag_n: toSafeNumber(point.drag_n, 0),
    yaw_deg: toSafeNumber(point.yaw_deg, 0),
    drs_open: Boolean(point.drs_open),
  };
}

function createSyntheticPoint(lastPoint = null) {
  const speed = toSafeNumber(lastPoint?.speed_kph, 308) + (Math.random() - 0.5) * 10;
  const drag = toSafeNumber(lastPoint?.drag_n, 1240) + (Math.random() - 0.5) * 50;
  const downforce = toSafeNumber(lastPoint?.downforce_n, 4360) + (Math.random() - 0.5) * 170;
  const yaw = toSafeNumber(lastPoint?.yaw_deg, 0.5) + (Math.random() - 0.5) * 0.3;

  return {
    speed_kph: Number(speed.toFixed(3)),
    drag_n: Number(Math.max(drag, 860).toFixed(3)),
    downforce_n: Number(Math.max(downforce, 2500).toFixed(3)),
    yaw_deg: Number(yaw.toFixed(4)),
    battery_soc: Number(Math.max(15, 62 + (Math.random() - 0.5) * 3).toFixed(3)),
    ers_deploy_kw: Number((218 + (Math.random() - 0.5) * 35).toFixed(3)),
    drs_open: speed > 300 && Math.abs(yaw) < 1.2,
    sector: [1, 2, 3][Math.floor(Math.random() * 3)],
  };
}

export default function ProductionTwinPanel() {
  const { token } = useAuth();
  const [carId, setCarId] = useState('car-44');
  const [telemetry, setTelemetry] = useState(null);
  const [summary, setSummary] = useState(null);
  const [digitalTwin, setDigitalTwin] = useState(null);
  const [streamStatus, setStreamStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [error, setError] = useState('');

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const manualCloseRef = useRef(false);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [recentRes, summaryRes, twinRes, streamRes] = await Promise.all([
        getJson('/api/evolution/production/telemetry/recent', {
          car_id: carId,
          limit: 80,
          fallback: true,
        }),
        getJson('/api/evolution/production/telemetry/summary', {
          car_ids: carId,
          limit_per_car: 120,
          fallback: true,
        }),
        getJson('/api/evolution/production/digital-twin/state', {
          car_id: carId,
        }),
        getJson('/api/evolution/production/stream/status'),
      ]);

      setTelemetry(recentRes?.data || null);
      setSummary(summaryRes?.data || null);
      setDigitalTwin(twinRes?.data || null);
      setStreamStatus(streamRes?.data || null);
      setError('');
    } catch (requestError) {
      setError(requestError?.message || 'Failed to load production telemetry');
    } finally {
      setLoading(false);
    }
  }, [carId]);

  const subscribeToCar = useCallback(() => {
    const socket = socketRef.current;
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
    if (!token) return;
    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) {
      try {
        socketRef.current.close();
      } catch (_error) {
        // no-op
      }
    }

    const base = backendWsUrl('/ws/evolution');
    const wsUrl = `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setStreamConnected(true);
      subscribeToCar();
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data || '{}'));
        const type = String(payload.type || '');
        const data = payload.data || {};

        if (type === 'telemetry_update') {
          if (String(data.car_id || '') !== carId) return;
          const point = normalizePoint(data.point);
          setTelemetry((previous) => {
            const previousPoints = Array.isArray(previous?.points) ? previous.points : [];
            const merged = [...previousPoints, point];
            const deduped = Array.from(
              new Map(merged.map((item) => [item.telemetry_id, item])).values()
            ).slice(-TELEMETRY_MAX_POINTS);

            return {
              ...(previous || {}),
              car_id: carId,
              points: deduped,
              total_points: toSafeNumber(data.total_points, deduped.length),
              summary: data.summary || previous?.summary || null,
            };
          });
          return;
        }

        if (type === 'digital_twin_update') {
          if (String(data.car_id || '') !== carId) return;
          setDigitalTwin(data.twin || null);
          return;
        }

        if (type === 'stream_error') {
          const code = String(data.code || '').toUpperCase();
          if (code === 'UNAUTHORIZED') {
            setError('WebSocket authentication failed for production stream.');
          } else if (code === 'FORBIDDEN') {
            setError('WebSocket subscription forbidden for selected car.');
          } else if (code === 'RATE_LIMITED') {
            setError('WebSocket subscription update rate-limited.');
          } else {
            setError(`Evolution stream error: ${String(data.message || 'unknown')}`);
          }
          return;
        }

        if (type === 'heartbeat') {
          setStreamStatus((previous) => ({
            ...(previous || {}),
            connected_clients: toSafeNumber(data.connected_clients, previous?.connected_clients || 0),
          }));
        }
      } catch (streamError) {
        setError(streamError?.message || 'Unable to parse stream payload');
      }
    };

    socket.onerror = () => {
      setStreamConnected(false);
    };

    socket.onclose = () => {
      setStreamConnected(false);
      if (manualCloseRef.current) return;
      reconnectTimerRef.current = setTimeout(() => {
        connectStream();
      }, 3000);
    };
  }, [carId, subscribeToCar, token]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!token) {
      setStreamConnected(false);
      return undefined;
    }

    manualCloseRef.current = false;
    connectStream();

    return () => {
      manualCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch (_error) {
          // no-op
        }
      }
    };
  }, [connectStream, token]);

  useEffect(() => {
    subscribeToCar();
  }, [subscribeToCar]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!streamConnected) {
        refreshAll();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [refreshAll, streamConnected]);

  const ingestPoint = async () => {
    setIngesting(true);
    try {
      const points = Array.isArray(telemetry?.points) ? telemetry.points : [];
      const latest = points[points.length - 1] || null;
      const payload = createSyntheticPoint(latest);
      await postJson('/api/evolution/production/telemetry/ingest', {
        car_id: carId,
        ...payload,
      });
      if (!streamConnected) {
        await refreshAll();
      }
      setError('');
    } catch (requestError) {
      setError(requestError?.message || 'Failed to ingest telemetry');
    } finally {
      setIngesting(false);
    }
  };

  const chartData = useMemo(() => {
    const points = Array.isArray(telemetry?.points) ? telemetry.points : [];
    return points.map((point) => ({
      t: compactIsoTime(point.timestamp),
      speed: toSafeNumber(point.speed_kph, 0),
      downforce: toSafeNumber(point.downforce_n, 0),
      drag: toSafeNumber(point.drag_n, 0),
    }));
  }, [telemetry]);

  const latest = chartData[chartData.length - 1] || null;
  const efficiency = latest
    ? toSafeNumber(latest.downforce, 0) / Math.max(toSafeNumber(latest.drag, 0), 1e-6)
    : null;
  const twinRecommendations = Array.isArray(digitalTwin?.recommendations)
    ? digitalTwin.recommendations
    : [];
  const summaryByCar = Array.isArray(summary?.by_car) ? summary.by_car[0] : null;

  return (
    <div className="qa-panel-grid">
      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h2>Production Twin</h2>
          <p>Live telemetry, digital-twin feedback, and authenticated WS stream parity.</p>
        </header>

        {loading ? <p className="qa-inline-info">Loading production stream state...</p> : null}
        {error ? <p className="qa-inline-error">{error}</p> : null}

        <div className="qa-form-grid">
          <label>
            <span>Car</span>
            <select value={carId} onChange={(event) => setCarId(event.target.value)}>
              <option value="car-44">car-44</option>
              <option value="car-16">car-16</option>
              <option value="car-01">car-01</option>
            </select>
          </label>
          <button className="qa-primary-btn" type="button" onClick={refreshAll}>
            Refresh Snapshot
          </button>
          <button className="qa-primary-btn" type="button" onClick={ingestPoint} disabled={ingesting}>
            {ingesting ? 'Injecting...' : 'Inject Telemetry'}
          </button>
        </div>

        <div className="qa-metric-grid">
          <MetricCard
            label="WS Stream"
            value={streamConnected ? 'CONNECTED' : 'POLLING'}
            subtitle={`Clients ${streamStatus?.connected_clients || 0}`}
            tone={streamConnected ? 'good' : 'warn'}
          />
          <MetricCard
            label="Latest Speed"
            value={latest ? `${num(latest.speed, 1)} kph` : 'n/a'}
            subtitle={`Points ${chartData.length}`}
          />
          <MetricCard
            label="L/D Proxy"
            value={efficiency !== null ? num(efficiency, 3) : 'n/a'}
            subtitle="Downforce / Drag"
            tone={efficiency !== null && efficiency > 2.8 ? 'good' : 'warn'}
          />
          <MetricCard
            label="Fleet Avg Drag"
            value={summaryByCar ? num(summaryByCar.avg_drag_n, 2) : 'n/a'}
            subtitle={`Updated ${since(summary?.generated_at || streamStatus?.last_heartbeat_at)}`}
          />
        </div>
      </section>

      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h3>Telemetry Timeline</h3>
        </header>
        <div className="qa-chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="4 4" stroke="rgba(255,255,255,0.12)" />
              <XAxis dataKey="t" stroke="rgba(255,255,255,0.68)" />
              <YAxis stroke="rgba(255,255,255,0.68)" />
              <Tooltip />
              <Line type="monotone" dataKey="speed" stroke="#79bbff" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="downforce" stroke="#7effb8" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="drag" stroke="#ffb39b" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="qa-panel-block">
        <header className="qa-panel-header">
          <h3>Digital Twin Guidance</h3>
        </header>
        <div className="qa-simple-list">
          <p><strong>State:</strong> <span>{digitalTwin?.status || 'n/a'}</span></p>
          <p><strong>Twin Car:</strong> <span>{digitalTwin?.car_id || carId}</span></p>
          <p><strong>Last Update:</strong> <span>{since(digitalTwin?.updated_at)}</span></p>
        </div>
      </section>

      <section className="qa-panel-block">
        <header className="qa-panel-header">
          <h3>Recommendations</h3>
        </header>
        <div className="qa-simple-list">
          {twinRecommendations.slice(0, 6).map((item, idx) => (
            <p key={`${item?.id || idx}`}>
              <strong>{item?.action || item?.label || `Action ${idx + 1}`}</strong>
              <span>{item?.confidence ? `${num(item.confidence, 2)}` : '-'}</span>
            </p>
          ))}
          {twinRecommendations.length === 0 ? (
            <p className="qa-empty">No recommendations currently available.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
