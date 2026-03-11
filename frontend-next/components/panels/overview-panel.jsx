'use client';

import { useEffect, useMemo, useState } from 'react';
import MetricCard from '@/components/ui/metric-card';
import { getJson } from '@/lib/api-client';
import { num, percent, since } from '@/lib/format';

export default function OverviewPanel() {
  const [health, setHealth] = useState(null);
  const [simulations, setSimulations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [healthRes, simulationRes] = await Promise.all([
          getJson('/api/system/health'),
          getJson('/api/simulation', { limit: 8, include_failed: true }),
        ]);
        if (disposed) return;
        setHealth(healthRes?.data || null);
        setSimulations(simulationRes?.data?.simulations || []);
      } catch (requestError) {
        if (disposed) return;
        setError(requestError?.message || 'Failed to load overview metrics');
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    load();
    const interval = setInterval(load, 9000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, []);

  const summary = health?.summary || {};
  const simSummary = health?.simulation || {};

  const topServices = useMemo(() => {
    const services = Array.isArray(health?.services) ? health.services : [];
    return services.slice(0, 4);
  }, [health]);

  return (
    <div className="qa-panel-grid">
      <section className="qa-panel-block">
        <header className="qa-panel-header">
          <h2>Platform Overview</h2>
          <p>Live backend, simulation, and service health mapped to your new production shell.</p>
        </header>

        {loading ? <p className="qa-inline-info">Loading overview signals...</p> : null}
        {error ? <p className="qa-inline-error">{error}</p> : null}

        <div className="qa-metric-grid">
          <MetricCard
            label="Availability"
            value={percent(summary.availability_percent, 1)}
            subtitle={`Healthy ${summary.healthy_services || 0}/${summary.total_services || 0} services`}
            tone={Number(summary.availability_percent) >= 95 ? 'good' : 'warn'}
          />
          <MetricCard
            label="Avg Latency"
            value={`${num(summary.avg_latency_ms, 1)} ms`}
            subtitle={`Backend response ${num(summary.backend_response_ms, 1)} ms`}
            tone={Number(summary.avg_latency_ms) < 300 ? 'good' : 'warn'}
          />
          <MetricCard
            label="Recent Runs"
            value={String(simSummary.recent_runs || 0)}
            subtitle={`Active jobs ${simSummary.active_jobs || 0}`}
          />
          <MetricCard
            label="Simulations Listed"
            value={String(simulations.length)}
            subtitle="Latest execution snapshots"
          />
        </div>
      </section>

      <section className="qa-panel-block">
        <header className="qa-panel-header">
          <h3>Service Status</h3>
        </header>
        <div className="qa-service-list">
          {topServices.map((service) => (
            <article key={service.key || service.name} className="qa-service-row">
              <div>
                <p className="qa-service-name">{service.name}</p>
                <p className="qa-service-meta">{service.base_url || 'internal'}</p>
              </div>
              <div className="qa-service-right">
                <span className={`qa-badge qa-badge-${service.status || 'unknown'}`}>{service.status || 'unknown'}</span>
                <span className="qa-service-meta">{num(service.latency_ms, 1)} ms</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <h3>Latest Simulations</h3>
        </header>
        <div className="qa-table-scroll">
          <table className="qa-table">
            <thead>
              <tr>
                <th>Simulation ID</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Started</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {simulations.map((sim) => (
                <tr key={sim.simulation_id}>
                  <td>{sim.simulation_id}</td>
                  <td>
                    <span className={`qa-badge qa-badge-${sim.status || 'unknown'}`}>{sim.status || 'unknown'}</span>
                  </td>
                  <td>{num(sim.progress, 0)}%</td>
                  <td>{since(sim.started_at)}</td>
                  <td>{sim.completed_at ? since(sim.completed_at) : '-'}</td>
                </tr>
              ))}
              {simulations.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5} className="qa-empty">No simulations available.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
