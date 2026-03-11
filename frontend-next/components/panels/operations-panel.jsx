'use client';

import { useEffect, useMemo, useState } from 'react';
import MetricCard from '@/components/ui/metric-card';
import { getJson } from '@/lib/api-client';
import { num, percent } from '@/lib/format';

export default function OperationsPanel() {
  const [alerts, setAlerts] = useState(null);
  const [slo, setSlo] = useState(null);
  const [config, setConfig] = useState(null);
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [alertsRes, sloRes, configRes, trendsRes] = await Promise.all([
          getJson('/api/system/observability/alerts', { window_minutes: 120 }),
          getJson('/api/system/observability/slo'),
          getJson('/api/system/observability/config'),
          getJson('/api/system/observability/incident-actions/trends', {
            window_minutes: 360,
            bucket_seconds: 1800,
            limit: 200,
          }),
        ]);

        if (disposed) return;
        setAlerts(alertsRes?.data || null);
        setSlo(sloRes?.data || null);
        setConfig(configRes?.data || null);
        setTrends(trendsRes?.data || null);
      } catch (requestError) {
        if (disposed) return;
        setError(requestError?.message || 'Failed to load operations telemetry');
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    load();
    const interval = setInterval(load, 15000);

    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, []);

  const wsCounters = alerts?.ws?.window_counters || {};
  const mode = alerts?.ws?.protection_mode || alerts?.ws?.protection?.mode || 'normal';

  const topActions = useMemo(() => {
    const rows = Array.isArray(trends?.summary?.top_actions) ? trends.summary.top_actions : [];
    return rows.slice(0, 6);
  }, [trends]);

  return (
    <div className="qa-panel-grid">
      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h2>Operations Control</h2>
          <p>Incident automation, websocket hardening, and SLO posture in a single dark operations view.</p>
        </header>

        {loading ? <p className="qa-inline-info">Loading observability data...</p> : null}
        {error ? <p className="qa-inline-error">{error}</p> : null}

        <div className="qa-metric-grid">
          <MetricCard
            label="WS Protection Mode"
            value={String(mode).toUpperCase()}
            subtitle={`Window ${num(alerts?.window_ms / 1000, 0)}s`}
            tone={mode === 'strict' ? 'warn' : 'good'}
          />
          <MetricCard
            label="WS Rate Limited"
            value={String(wsCounters.rate_limited || 0)}
            subtitle={`Dropped ${wsCounters.dropped_messages || 0}`}
            tone={Number(wsCounters.rate_limited || 0) > 0 ? 'warn' : 'good'}
          />
          <MetricCard
            label="SLO Availability"
            value={percent(slo?.availability_percent, 2)}
            subtitle={`Target ${percent(slo?.target_percent, 2)}`}
            tone={Number(slo?.availability_percent || 0) >= Number(slo?.target_percent || 99) ? 'good' : 'danger'}
          />
          <MetricCard
            label="Alert Thresholds"
            value={String(config?.thresholds ? Object.keys(config.thresholds).length : 0)}
            subtitle="Configured operational guards"
          />
        </div>
      </section>

      <section className="qa-panel-block">
        <header className="qa-panel-header">
          <h3>WebSocket Signals</h3>
        </header>
        <div className="qa-simple-list">
          <p><strong>Auth Failures:</strong> {wsCounters.auth_failures || 0}</p>
          <p><strong>Denied Subscriptions:</strong> {wsCounters.unauthorized_subscriptions || 0}</p>
          <p><strong>Rejected Connections:</strong> {wsCounters.rejected_connections || 0}</p>
          <p><strong>Subscribe Bursts:</strong> {wsCounters.subscribe_rate_limited || 0}</p>
          <p><strong>Connection Closes:</strong> {wsCounters.closed_by_backpressure || 0}</p>
        </div>
      </section>

      <section className="qa-panel-block">
        <header className="qa-panel-header">
          <h3>Top Incident Actions</h3>
        </header>
        <div className="qa-simple-list">
          {topActions.map((item) => (
            <p key={item.action}>
              <strong>{item.action}</strong> <span>{item.count}</span>
            </p>
          ))}
          {topActions.length === 0 ? <p className="qa-empty">No incident actions in current window.</p> : null}
        </div>
      </section>

      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h3>Raw SLO + Alert Payloads</h3>
          <p>Useful during migration to verify strict contract parity with the legacy dashboard.</p>
        </header>
        <div className="qa-json-grid">
          <pre>{JSON.stringify(alerts || {}, null, 2)}</pre>
          <pre>{JSON.stringify(slo || {}, null, 2)}</pre>
        </div>
      </section>
    </div>
  );
}
