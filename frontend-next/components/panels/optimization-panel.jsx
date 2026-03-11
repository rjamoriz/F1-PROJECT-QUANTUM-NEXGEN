'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, TrendingUp, TrendingDown, Target, Clock, CheckCircle2, XCircle, Loader2, Settings2 } from 'lucide-react';
import MetricCard from '@/components/ui/metric-card';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function OptimizationPanel() {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [result, setResult] = useState(null);
  const [recentRuns, setRecentRuns] = useState([]);
  const [error, setError] = useState('');
  const [config, setConfig] = useState({
    num_candidates: 16,
    top_k: 3,
    quantum_method: 'auto',
    vlm_validation: true,
    objectives: {
      downforce_weight: 1.0,
      drag_weight: 0.5,
      balance_weight: 0.3,
      stall_weight: 0.3
    }
  });

  // Fetch recent optimization runs
  const fetchRecent = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/aero/optimize/recent?limit=5`);
      if (response.ok) {
        const data = await response.json();
        setRecentRuns(data.runs || []);
      }
    } catch (err) {
      console.error('Failed to fetch recent runs:', err);
    }
  }, []);

  useEffect(() => {
    fetchRecent();
    const interval = setInterval(fetchRecent, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [fetchRecent]);

  // Run optimization
  const runOptimization = async () => {
    setIsOptimizing(true);
    setError('');
    setResult(null);

    try {
      const payload = {
        design_space: {
          type: 'continuous',
          parameters: {
            wing_angle: { min: 3.0, max: 8.0 },
            ride_height: { min: 60.0, max: 90.0 },
            diffuser_angle: { min: 10.0, max: 20.0 },
            front_wing_flap: { min: 15.0, max: 35.0 }
          }
        },
        flow_conditions: {
          airspeed_ms: 60.0,
          altitude_m: 100.0,
          air_density: 1.225,
          temperature_c: 20.0
        },
        objectives: config.objectives,
        constraints: {
          penalty_weight: 10.0
        },
        num_candidates: config.num_candidates,
        top_k: config.top_k,
        quantum_method: config.quantum_method,
        vlm_validation: config.vlm_validation
      };

      const response = await fetch(`${API_BASE}/api/v1/aero/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Optimization failed');
      }

      const data = await response.json();
      setResult(data);
      fetchRecent(); // Refresh recent runs
    } catch (err) {
      setError(err.message || 'Unknown error');
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <div className="qa-panel-grid">
      {/* Configuration Section */}
      <section className="qa-panel-block qa-panel-span-2">
        <header className="qa-panel-header">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-cyan-400" />
            <h2>Optimization Configuration</h2>
          </div>
          <p>Configure quantum-hybrid aerodynamic optimization parameters</p>
        </header>

        <div className="qa-form-grid">
          <label>
            <span>Candidates</span>
            <input
              type="number"
              min="8"
              max="64"
              step="8"
              value={config.num_candidates}
              onChange={(e) => setConfig({...config, num_candidates: parseInt(e.target.value)})}
              className="qa-input"
            />
          </label>

          <label>
            <span>Top-K Selection</span>
            <input
              type="number"
              min="1"
              max="10"
              value={config.top_k}
              onChange={(e) => setConfig({...config, top_k: parseInt(e.target.value)})}
              className="qa-input"
            />
          </label>

          <label>
            <span>Quantum Method</span>
            <select
              value={config.quantum_method}
              onChange={(e) => setConfig({...config, quantum_method: e.target.value})}
              className="qa-input"
            >
              <option value="auto">Auto (QAOA/Classical Hybrid)</option>
              <option value="qaoa">QAOA (Quantum)</option>
              <option value="classical">Classical Only</option>
            </select>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.vlm_validation}
              onChange={(e) => setConfig({...config, vlm_validation: e.target.checked})}
              className="qa-checkbox"
            />
            <span>VLM Validation</span>
          </label>
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Objective Weights</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(config.objectives).map(([key, value]) => (
              <label key={key} className="qa-form-field">
                <span className="text-xs capitalize">{key.replace('_weight', '')}</span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={value}
                  onChange={(e) => setConfig({
                    ...config,
                    objectives: {...config.objectives, [key]: parseFloat(e.target.value)}
                  })}
                  className="qa-input text-sm"
                />
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={runOptimization}
          disabled={isOptimizing}
          className="qa-btn qa-btn-primary mt-4 w-full md:w-auto"
        >
          {isOptimizing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Optimizing...</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              <span>Run Optimization</span>
            </>
          )}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm flex items-start gap-2">
            <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {/* Results Section */}
      {result && (
        <AnimatePresence>
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="qa-panel-block qa-panel-span-3"
          >
            <header className="qa-panel-header">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <h2>Optimization Result</h2>
              </div>
              <p>Run ID: <code className="text-xs text-cyan-400">{result.run_id}</code></p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <MetricCard
                label="Downforce (Cl)"
                value={result.result?.performance?.cl?.toFixed(3) || 'N/A'}
                icon={TrendingUp}
                tone="good"
              />
              <MetricCard
                label="Drag (Cd)"
                value={result.result?.performance?.cd?.toFixed(3) || 'N/A'}
                icon={TrendingDown}
                tone="warn"
              />
              <MetricCard
                label="Composite Score"
                value={result.result?.performance?.composite_score?.toFixed(3) || 'N/A'}
                icon={Target}
                tone="good"
              />
              <MetricCard
                label="Balance Proxy"
                value={result.result?.performance?.balance_proxy?.toFixed(3) || 'N/A'}
                icon={Target}
                tone={result.result?.performance?.balance_proxy < 0.5 ? 'good' : 'warn'}
              />
              <MetricCard
                label="Stall Risk"
                value={result.result?.performance?.stall_risk?.toFixed(3) || 'N/A'}
                icon={Target}
                tone={result.result?.performance?.stall_risk < 0.3 ? 'good' : 'danger'}
              />
              <MetricCard
                label="Compute Time"
                value={`${result.metadata?.compute_time_ms || 0}ms`}
                icon={Clock}
                tone="default"
              />
            </div>

            <div className="qa-section-divide">
              <h3 className="text-sm font-medium text-gray-300">Best Design Parameters</h3>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(result.result?.design?.parameters || {}).map(([param, value]) => (
                  <div key={param} className="p-2 bg-gray-800/50 rounded border border-gray-700/50">
                    <div className="text-xs text-gray-400 capitalize">{param.replace('_', ' ')}</div>
                    <div className="text-sm font-mono text-cyan-400">{value.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="qa-section-divide">
              <h3 className="text-sm font-medium text-gray-300">Quantum Metadata</h3>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-gray-400">Method:</span>{' '}
                  <span className="text-cyan-400">{result.metadata?.quantum_method || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-400">Candidates:</span>{' '}
                  <span className="text-white">{result.metadata?.total_candidates || 0}</span>
                </div>
                <div>
                  <span className="text-gray-400">Cost:</span>{' '}
                  <span className="text-white">{result.metadata?.quantum_cost?.toFixed(4) || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-400">Iterations:</span>{' '}
                  <span className="text-white">{result.metadata?.quantum_iterations || 'N/A'}</span>
                </div>
              </div>
            </div>

            {result.result?.top_k && result.result.top_k.length > 0 && (
              <div className="qa-section-divide">
                <h3 className="text-sm font-medium text-gray-300">Top-{result.result.top_k.length} Candidates</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {result.result.top_k.map((candidateId, idx) => (
                    <span
                      key={candidateId}
                      className={`px-3 py-1 rounded text-xs font-mono ${
                        idx === 0
                          ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                          : 'bg-gray-700/50 text-gray-300 border border-gray-600/30'
                      }`}
                    >
                      {candidateId}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.section>
        </AnimatePresence>
      )}

      {/* Recent Runs */}
      <section className="qa-panel-block qa-panel-span-3">
        <header className="qa-panel-header">
          <h2>Recent Optimization Runs</h2>
          <p>{recentRuns.length} run(s) • Auto-refresh every 10s</p>
        </header>

        {recentRuns.length === 0 ? (
          <p className="text-sm text-gray-400">No recent optimization runs</p>
        ) : (
          <div className="space-y-2">
            {recentRuns.map((run) => (
              <div
                key={run.runId}
                className="p-3 bg-gray-800/30 border border-gray-700/50 rounded hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <code className="text-xs text-cyan-400">{run.runId}</code>
                  <span className="text-xs text-gray-400">
                    {new Date(run.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-2 text-xs">
                  <div>
                    <span className="text-gray-400">Cl:</span>{' '}
                    <span className="text-white">{run.result?.performance?.cl?.toFixed(3) || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Cd:</span>{' '}
                    <span className="text-white">{run.result?.performance?.cd?.toFixed(3) || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Balance:</span>{' '}
                    <span className="text-white">{run.result?.performance?.balance_proxy?.toFixed(3) || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Method:</span>{' '}
                    <span className="text-cyan-400">{run.quantum_method || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Time:</span>{' '}
                    <span className="text-white">{run.computeTimeMs || 0}ms</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
