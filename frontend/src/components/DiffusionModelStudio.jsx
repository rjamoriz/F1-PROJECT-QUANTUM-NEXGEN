/**
 * Diffusion Model Studio (Phase 3)
 * Frontend contract for diffusion-style design generation + RL active control.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import { Brain, Sparkles, Target, Zap } from './lucideShim';
import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

const API_BASE = BACKEND_API_BASE;

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatDelta(value, decimals = 2) {
  const numeric = toSafeNumber(value, 0);
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(decimals)}`;
}

const DiffusionModelStudio = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEvaluatingRl, setIsEvaluatingRl] = useState(false);
  const [isTrainingRl, setIsTrainingRl] = useState(false);
  const [generationError, setGenerationError] = useState(null);
  const [rlError, setRlError] = useState(null);
  const [rlTrainingError, setRlTrainingError] = useState(null);
  const [diffusionData, setDiffusionData] = useState(null);
  const [rlData, setRlData] = useState(null);
  const [rlTrainingRun, setRlTrainingRun] = useState(null);
  const [rlPolicies, setRlPolicies] = useState([]);
  const rlPollingTimeoutRef = useRef(null);

  const [diffusionConfig, setDiffusionConfig] = useState({
    num_candidates: 36,
    target_cl: 2.8,
    target_cd: 0.4,
    target_cm: -0.1,
    diffusion_steps: 60,
    guidance_scale: 7.5,
    latent_dim: 32,
  });

  const [rlState, setRlState] = useState({
    speed_kph: 312,
    yaw_deg: 0.55,
    battery_soc: 63,
    tire_temp_c: 97,
    drs_available: true,
    sector: 3,
    track_id: 'global',
  });

  const [rlTrainingConfig, setRlTrainingConfig] = useState({
    track_id: 'global',
    episodes: 1600,
    eval_episodes: 80,
    target_style: 'balanced',
    auto_deploy: true,
  });

  const generateDiffusionCandidates = async () => {
    setIsGenerating(true);
    try {
      const response = await axios.post(`${API_BASE}/api/evolution/generative/diffusion/generate`, diffusionConfig);
      setDiffusionData(response?.data?.data || null);
      setGenerationError(null);
    } catch (error) {
      setGenerationError(error?.message || 'Failed to generate diffusion candidates');
    } finally {
      setIsGenerating(false);
    }
  };

  const evaluateRlRecommendation = async () => {
    setIsEvaluatingRl(true);
    try {
      const response = await axios.post(`${API_BASE}/api/evolution/generative/rl/recommend`, {
        state: rlState,
      });
      setRlData(response?.data?.data || null);
      setRlError(null);
    } catch (error) {
      setRlError(error?.message || 'Failed to evaluate RL policy recommendation');
    } finally {
      setIsEvaluatingRl(false);
    }
  };

  const refreshRlPolicies = async (trackId) => {
    const response = await axios.get(`${API_BASE}/api/evolution/generative/rl/policies`, {
      params: {
        track_id: trackId || undefined,
        limit: 6,
      },
    });
    setRlPolicies(Array.isArray(response?.data?.data?.policies) ? response.data.data.policies : []);
  };

  const clearRlPollingTimer = () => {
    if (rlPollingTimeoutRef.current) {
      clearTimeout(rlPollingTimeoutRef.current);
      rlPollingTimeoutRef.current = null;
    }
  };

  useEffect(() => () => clearRlPollingTimer(), []);

  const pollRlTrainingRun = async (runId, attempt = 0) => {
    try {
      const response = await axios.get(`${API_BASE}/api/evolution/generative/rl/train/${runId}`, {
        params: {
          sync: true,
        },
      });
      const run = response?.data?.data || null;
      if (!run) {
        return;
      }
      setRlTrainingRun(run);

      const status = String(run.status || '').toLowerCase();
      const isTerminal = status === 'completed' || status === 'failed';
      if (isTerminal || attempt >= 40) {
        await refreshRlPolicies(run.track_id || rlTrainingConfig.track_id);
        return;
      }

      rlPollingTimeoutRef.current = setTimeout(() => {
        pollRlTrainingRun(runId, attempt + 1);
      }, 2000);
    } catch (_error) {
      if (attempt >= 4) {
        return;
      }
      rlPollingTimeoutRef.current = setTimeout(() => {
        pollRlTrainingRun(runId, attempt + 1);
      }, 2500);
    }
  };

  const trainRlPolicy = async () => {
    setIsTrainingRl(true);
    clearRlPollingTimer();
    try {
      const response = await axios.post(`${API_BASE}/api/evolution/generative/rl/train`, {
        track_id: rlTrainingConfig.track_id,
        auto_deploy: rlTrainingConfig.auto_deploy,
        config: {
          episodes: rlTrainingConfig.episodes,
          eval_episodes: rlTrainingConfig.eval_episodes,
          target_style: rlTrainingConfig.target_style,
        },
      });
      const run = response?.data?.data?.run || null;
      setRlTrainingRun(run);
      setRlTrainingError(null);
      setRlState((prev) => ({
        ...prev,
        track_id: rlTrainingConfig.track_id,
      }));
      const status = String(run?.status || '').toLowerCase();
      const isTerminal = status === 'completed' || status === 'failed';
      if (run?.run_id && !isTerminal) {
        rlPollingTimeoutRef.current = setTimeout(() => {
          pollRlTrainingRun(run.run_id, 0);
        }, 1200);
      } else {
        await refreshRlPolicies(rlTrainingConfig.track_id);
      }
    } catch (error) {
      setRlTrainingError(error?.message || 'Failed to train RL policy');
    } finally {
      setIsTrainingRl(false);
    }
  };

  const topCandidates = useMemo(() => {
    const candidates = Array.isArray(diffusionData?.candidates) ? diffusionData.candidates : [];
    return [...candidates]
      .sort((a, b) => toSafeNumber(b.quality_score, 0) - toSafeNumber(a.quality_score, 0))
      .slice(0, 8);
  }, [diffusionData]);

  const scatterData = useMemo(() => {
    const candidates = Array.isArray(diffusionData?.candidates) ? diffusionData.candidates : [];
    return candidates.map((candidate) => ({
      id: candidate.id,
      cl: toSafeNumber(candidate?.parameters?.cl, 0),
      cd: toSafeNumber(candidate?.parameters?.cd, 0),
      quality: toSafeNumber(candidate?.quality_score, 0),
      novelty: toSafeNumber(candidate?.novelty_score, 0),
    }));
  }, [diffusionData]);

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Brain className="w-6 h-6 text-indigo-600" />
        Diffusion + RL Studio (Phase 3)
      </h2>

      <p className="text-gray-600 mb-6">
        Generate aerodynamic candidates with diffusion-style sampling and compute active-control recommendations with an RL policy contract.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="p-4 border border-indigo-200 bg-indigo-50 rounded">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Diffusion Candidate Generation
          </h3>

          {generationError && (
            <div className="mb-3 p-2 text-sm bg-red-50 border border-red-200 rounded text-red-700">
              {generationError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="text-sm">
              <span className="block font-medium mb-1">Candidates</span>
              <input
                type="number"
                value={diffusionConfig.num_candidates}
                onChange={(event) => setDiffusionConfig((prev) => ({ ...prev, num_candidates: parseInt(event.target.value, 10) }))}
                className="w-full px-3 py-2 border rounded"
                min="1"
                max="250"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Target Cl</span>
              <input
                type="number"
                step="0.05"
                value={diffusionConfig.target_cl}
                onChange={(event) => setDiffusionConfig((prev) => ({ ...prev, target_cl: parseFloat(event.target.value) }))}
                className="w-full px-3 py-2 border rounded"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Target Cd</span>
              <input
                type="number"
                step="0.01"
                value={diffusionConfig.target_cd}
                onChange={(event) => setDiffusionConfig((prev) => ({ ...prev, target_cd: parseFloat(event.target.value) }))}
                className="w-full px-3 py-2 border rounded"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Target Cm</span>
              <input
                type="number"
                step="0.01"
                value={diffusionConfig.target_cm}
                onChange={(event) => setDiffusionConfig((prev) => ({ ...prev, target_cm: parseFloat(event.target.value) }))}
                className="w-full px-3 py-2 border rounded"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Diffusion Steps</span>
              <input
                type="number"
                value={diffusionConfig.diffusion_steps}
                onChange={(event) => setDiffusionConfig((prev) => ({ ...prev, diffusion_steps: parseInt(event.target.value, 10) }))}
                className="w-full px-3 py-2 border rounded"
                min="10"
                max="200"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Guidance Scale</span>
              <input
                type="number"
                step="0.1"
                value={diffusionConfig.guidance_scale}
                onChange={(event) => setDiffusionConfig((prev) => ({ ...prev, guidance_scale: parseFloat(event.target.value) }))}
                className="w-full px-3 py-2 border rounded"
              />
            </label>
          </div>

          <button
            onClick={generateDiffusionCandidates}
            disabled={isGenerating}
            className={`w-full px-4 py-3 rounded font-semibold flex items-center justify-center gap-2 ${
              isGenerating ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
          >
            <Sparkles className="w-5 h-5" />
            {isGenerating ? 'Generating...' : 'Generate Diffusion Candidates'}
          </button>

          {diffusionData?.stats && (
            <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
              <div className="p-2 bg-white border rounded">
                <strong>Generated:</strong> {toSafeNumber(diffusionData?.stats?.num_generated, 0)}
              </div>
              <div className="p-2 bg-white border rounded">
                <strong>Seed Count:</strong> {toSafeNumber(diffusionData?.stats?.seed_count, 0)}
              </div>
              <div className="p-2 bg-white border rounded">
                <strong>Avg Quality:</strong> {toSafeNumber(diffusionData?.stats?.avg_quality_score, 0).toFixed(3)}
              </div>
              <div className="p-2 bg-white border rounded">
                <strong>Target Hit:</strong> {(toSafeNumber(diffusionData?.stats?.target_hit_rate, 0) * 100).toFixed(1)}%
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border border-emerald-200 bg-emerald-50 rounded">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Zap className="w-5 h-5" />
            RL Active Control Recommendation
          </h3>

          {rlError && (
            <div className="mb-3 p-2 text-sm bg-red-50 border border-red-200 rounded text-red-700">
              {rlError}
            </div>
          )}
          {rlTrainingError && (
            <div className="mb-3 p-2 text-sm bg-red-50 border border-red-200 rounded text-red-700">
              {rlTrainingError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="text-sm">
              <span className="block font-medium mb-1">Speed (kph)</span>
              <input
                type="number"
                value={rlState.speed_kph}
                onChange={(event) => setRlState((prev) => ({ ...prev, speed_kph: parseFloat(event.target.value) }))}
                className="w-full px-3 py-2 border rounded"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Yaw (deg)</span>
              <input
                type="number"
                step="0.05"
                value={rlState.yaw_deg}
                onChange={(event) => setRlState((prev) => ({ ...prev, yaw_deg: parseFloat(event.target.value) }))}
                className="w-full px-3 py-2 border rounded"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Battery SOC (%)</span>
              <input
                type="number"
                value={rlState.battery_soc}
                onChange={(event) => setRlState((prev) => ({ ...prev, battery_soc: parseFloat(event.target.value) }))}
                className="w-full px-3 py-2 border rounded"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Tire Temp (°C)</span>
              <input
                type="number"
                value={rlState.tire_temp_c}
                onChange={(event) => setRlState((prev) => ({ ...prev, tire_temp_c: parseFloat(event.target.value) }))}
                className="w-full px-3 py-2 border rounded"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Track ID</span>
              <input
                type="text"
                value={rlState.track_id}
                onChange={(event) => setRlState((prev) => ({ ...prev, track_id: event.target.value }))}
                className="w-full px-3 py-2 border rounded"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={rlState.drs_available}
                onChange={(event) => setRlState((prev) => ({ ...prev, drs_available: event.target.checked }))}
              />
              DRS Available
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Sector</span>
              <select
                value={rlState.sector}
                onChange={(event) => setRlState((prev) => ({ ...prev, sector: parseInt(event.target.value, 10) }))}
                className="w-full px-3 py-2 border rounded"
              >
                <option value={1}>Sector 1</option>
                <option value={2}>Sector 2</option>
                <option value={3}>Sector 3</option>
              </select>
            </label>
          </div>

          <button
            onClick={evaluateRlRecommendation}
            disabled={isEvaluatingRl}
            className={`w-full px-4 py-3 rounded font-semibold flex items-center justify-center gap-2 ${
              isEvaluatingRl ? 'bg-gray-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            <Target className="w-5 h-5" />
            {isEvaluatingRl ? 'Evaluating...' : 'Evaluate RL Action'}
          </button>

          <div className="mt-4 p-3 bg-white border border-emerald-200 rounded">
            <div className="font-semibold mb-2">Train / Refresh RL Policy</div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <label className="text-xs">
                <span className="block font-medium mb-1">Track</span>
                <input
                  type="text"
                  value={rlTrainingConfig.track_id}
                  onChange={(event) => setRlTrainingConfig((prev) => ({ ...prev, track_id: event.target.value }))}
                  className="w-full px-2 py-1 border rounded"
                />
              </label>
              <label className="text-xs">
                <span className="block font-medium mb-1">Episodes</span>
                <input
                  type="number"
                  min="10"
                  max="50000"
                  value={rlTrainingConfig.episodes}
                  onChange={(event) => setRlTrainingConfig((prev) => ({ ...prev, episodes: parseInt(event.target.value, 10) || 10 }))}
                  className="w-full px-2 py-1 border rounded"
                />
              </label>
              <label className="text-xs">
                <span className="block font-medium mb-1">Eval Episodes</span>
                <input
                  type="number"
                  min="5"
                  max="1000"
                  value={rlTrainingConfig.eval_episodes}
                  onChange={(event) => setRlTrainingConfig((prev) => ({ ...prev, eval_episodes: parseInt(event.target.value, 10) || 5 }))}
                  className="w-full px-2 py-1 border rounded"
                />
              </label>
              <label className="text-xs">
                <span className="block font-medium mb-1">Style</span>
                <select
                  value={rlTrainingConfig.target_style}
                  onChange={(event) => setRlTrainingConfig((prev) => ({ ...prev, target_style: event.target.value }))}
                  className="w-full px-2 py-1 border rounded"
                >
                  <option value="balanced">Balanced</option>
                  <option value="aggressive">Aggressive</option>
                  <option value="conservative">Conservative</option>
                </select>
              </label>
            </div>
            <label className="text-xs flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                checked={rlTrainingConfig.auto_deploy}
                onChange={(event) => setRlTrainingConfig((prev) => ({ ...prev, auto_deploy: event.target.checked }))}
              />
              Auto-deploy policy on completion
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={trainRlPolicy}
                disabled={isTrainingRl}
                className={`px-3 py-2 rounded text-sm font-semibold ${
                  isTrainingRl ? 'bg-gray-400 cursor-not-allowed' : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                }`}
              >
                {isTrainingRl ? 'Training...' : 'Train Policy'}
              </button>
              <button
                onClick={() => refreshRlPolicies(rlTrainingConfig.track_id)}
                className="px-3 py-2 rounded text-sm font-semibold bg-emerald-100 hover:bg-emerald-200 text-emerald-800"
              >
                Refresh Policies
              </button>
            </div>
          </div>

          {rlData && (
            <div className="mt-4 space-y-2 text-sm">
              <div className="p-2 bg-white border rounded">
                <strong>Policy:</strong> {rlData.policy}
              </div>
              <div className="p-2 bg-white border rounded">
                <strong>Policy Source:</strong> {rlData?.policy_metadata?.source || 'n/a'}
                {' '}| <strong>Run:</strong> {rlData?.policy_metadata?.training_run_id || 'n/a'}
              </div>
              <div className="p-2 bg-white border rounded">
                <strong>Action:</strong> DRS {rlData?.action?.drs_open ? 'OPEN' : 'CLOSED'} | Flap {toSafeNumber(rlData?.action?.flap_angle_deg, 0).toFixed(2)}°
              </div>
              <div className="p-2 bg-white border rounded">
                <strong>Expected:</strong> ΔDownforce {formatDelta(rlData?.expected_delta?.downforce_n, 1)} N, ΔDrag {formatDelta(rlData?.expected_delta?.drag_n, 1)} N, ΔLap {formatDelta(rlData?.expected_delta?.lap_time_ms, 1)} ms
              </div>
              <div className="p-2 bg-white border rounded">
                <strong>Confidence:</strong> {(toSafeNumber(rlData?.confidence, 0) * 100).toFixed(1)}%
              </div>
            </div>
          )}

          {rlTrainingRun && (
            <div className="mt-4 space-y-2 text-sm">
              <div className="p-2 bg-white border rounded">
                <strong>Latest Training Run:</strong> {rlTrainingRun.run_id}
              </div>
              <div className="p-2 bg-white border rounded">
                <strong>Track:</strong> {rlTrainingRun.track_id}
                {' '}| <strong>Status:</strong> {rlTrainingRun.status}
                {' '}| <strong>Active:</strong> {rlTrainingRun?.deployment?.active ? 'yes' : 'no'}
              </div>
              <div className="p-2 bg-white border rounded">
                <strong>Run State:</strong>
                {' '}progress {toSafeNumber(
                  rlTrainingRun?.config?.service_job?.progress_percent
                  ?? rlTrainingRun?.metrics?.progress_percent,
                  0
                ).toFixed(1)}%
                {' '}| queue {toSafeNumber(rlTrainingRun?.config?.service_job?.queue_position, 0).toFixed(0)}
                {' '}| sync failures {toSafeNumber(rlTrainingRun?.config?.service_job?.sync_failures, 0).toFixed(0)}
              </div>
              <div className="p-2 bg-white border rounded">
                <strong>Metrics:</strong>
                {' '}reward {toSafeNumber(rlTrainingRun?.metrics?.mean_episode_reward, 0).toFixed(3)},
                {' '}lap gain {toSafeNumber(rlTrainingRun?.metrics?.lap_time_gain_ms, 0).toFixed(2)}ms,
                {' '}stability {(toSafeNumber(rlTrainingRun?.metrics?.stability_score, 0) * 100).toFixed(1)}%
              </div>
              {rlTrainingRun?.config?.deployment_gate && (
                <div className={`p-2 border rounded ${
                  rlTrainingRun.config.deployment_gate.blocked
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
                >
                  <strong>Deployment Guardrail:</strong>
                  {' '}
                  {rlTrainingRun.config.deployment_gate.blocked ? 'BLOCKED' : 'eligible'}
                  {Array.isArray(rlTrainingRun?.config?.deployment_gate?.reasons)
                    && rlTrainingRun.config.deployment_gate.reasons.length > 0 && (
                    <div className="mt-1 text-xs">
                      {rlTrainingRun.config.deployment_gate.reasons
                        .map((reason) => reason?.code || 'guardrail_reason')
                        .join(', ')}
                    </div>
                  )}
                </div>
              )}
              {rlTrainingRun?.config?.service_job?.last_error && (
                <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700">
                  <strong>Last Sync Error:</strong> {String(rlTrainingRun.config.service_job.last_error)}
                </div>
              )}
            </div>
          )}

          {rlPolicies.length > 0 && (
            <div className="mt-4 p-2 bg-white border rounded text-xs">
              <div className="font-semibold mb-1">Recent RL Policies ({rlPolicies.length})</div>
              <div className="space-y-1">
                {rlPolicies.map((policy) => (
                  <div key={policy.run_id} className="border-b border-gray-100 pb-1">
                    {policy.policy_name} · {policy.track_id} · {policy.deployment?.active ? 'active' : 'inactive'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {scatterData.length > 0 && (
        <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded">
          <h3 className="font-semibold mb-3">Diffusion Design Space</h3>
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 15, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="cl"
                name="Cl"
                label={{ value: 'Lift Coefficient (Cl)', position: 'insideBottom', offset: -5 }}
              />
              <YAxis
                dataKey="cd"
                name="Cd"
                label={{ value: 'Drag Coefficient (Cd)', angle: -90, position: 'insideLeft' }}
              />
              <ZAxis dataKey="quality" range={[80, 320]} name="Quality" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Legend />
              <Scatter name="Candidates" data={scatterData} fill="#4338ca" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {topCandidates.length > 0 && (
        <div className="mt-6 p-4 bg-white border border-gray-200 rounded">
          <h3 className="font-semibold mb-3">Top Diffusion Candidates</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">ID</th>
                  <th className="py-2 pr-4">Cl</th>
                  <th className="py-2 pr-4">Cd</th>
                  <th className="py-2 pr-4">L/D</th>
                  <th className="py-2 pr-4">Quality</th>
                  <th className="py-2 pr-4">Novelty</th>
                </tr>
              </thead>
              <tbody>
                {topCandidates.map((candidate) => (
                  <tr key={candidate.id} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-mono text-xs">{candidate.id}</td>
                    <td className="py-2 pr-4">{toSafeNumber(candidate?.parameters?.cl, 0).toFixed(3)}</td>
                    <td className="py-2 pr-4">{toSafeNumber(candidate?.parameters?.cd, 0).toFixed(4)}</td>
                    <td className="py-2 pr-4">{toSafeNumber(candidate?.parameters?.l_over_d, 0).toFixed(3)}</td>
                    <td className="py-2 pr-4">{toSafeNumber(candidate.quality_score, 0).toFixed(3)}</td>
                    <td className="py-2 pr-4">{toSafeNumber(candidate.novelty_score, 0).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiffusionModelStudio;
