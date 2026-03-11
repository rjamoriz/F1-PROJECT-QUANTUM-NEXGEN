/**
 * Evolution Routes (Phase 3 + Phase 4)
 * - Diffusion model generation contract with real model-service adapter
 * - RL active control recommendation contract
 * - Mongo-backed telemetry ingestion/retrieval
 * - Digital twin state synthesis and websocket streaming
 */

const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const TelemetryPoint = require('../models/TelemetryPoint');
const RlPolicyRun = require('../models/RlPolicyRun');
const { createServiceClient } = require('../utils/serviceClient');
const { recordAuditEvent } = require('../services/auditLogStore');
const {
  parseBearerToken,
  verifyAccessToken,
} = require('../services/authTokens');
const {
  publishEvolutionEvent,
  getEvolutionStreamStatus,
} = require('../services/evolutionStream');

const router = express.Router();

const telemetryFallbackStore = new Map();
const TELEMETRY_MAX_POINTS = 2400;
const TELEMETRY_DEFAULT_LIMIT = 50;
const TELEMETRY_MAX_LIMIT = 400;
const RL_POLICY_MAX_RUNS = 1200;

const DIFFUSION_SERVICE_URL = process.env.DIFFUSION_SERVICE_URL || process.env.ML_SERVICE_URL || 'http://localhost:8000';
const DIFFUSION_SERVICE_ENDPOINT = process.env.DIFFUSION_SERVICE_ENDPOINT || '/api/v1/diffusion/generate';
const DIFFUSION_SERVICE_TIMEOUT_MS = Number.isFinite(Number(process.env.DIFFUSION_SERVICE_TIMEOUT_MS))
  ? Number(process.env.DIFFUSION_SERVICE_TIMEOUT_MS)
  : 12000;
const RL_TRAINING_SERVICE_URL = process.env.RL_TRAINING_SERVICE_URL || process.env.ML_SERVICE_URL || 'http://localhost:8000';
const RL_TRAINING_SUBMIT_ENDPOINT = process.env.RL_TRAINING_SUBMIT_ENDPOINT || '/api/v1/rl/train';
const RL_TRAINING_STATUS_ENDPOINT = process.env.RL_TRAINING_STATUS_ENDPOINT || '/api/v1/rl/jobs/:job_id';
const RL_TRAINING_TIMEOUT_MS = Number.isFinite(Number(process.env.RL_TRAINING_TIMEOUT_MS))
  ? Number(process.env.RL_TRAINING_TIMEOUT_MS)
  : 30000;
const RL_TRAINING_SYNC_INTERVAL_MS = Number.isFinite(Number(process.env.RL_TRAINING_SYNC_INTERVAL_MS))
  ? clamp(Math.round(Number(process.env.RL_TRAINING_SYNC_INTERVAL_MS)), 1000, 300000)
  : 5000;
const RL_TRAINING_ALLOW_SYNTHETIC_FALLBACK = String(
  process.env.RL_TRAINING_ALLOW_SYNTHETIC_FALLBACK || 'false'
).toLowerCase() === 'true';
const RL_TRAINING_SUBMIT_MAX_RETRIES = Number.isFinite(Number(process.env.RL_TRAINING_SUBMIT_MAX_RETRIES))
  ? clamp(Math.round(Number(process.env.RL_TRAINING_SUBMIT_MAX_RETRIES)), 0, 10)
  : 2;
const RL_TRAINING_SYNC_MAX_RETRIES = Number.isFinite(Number(process.env.RL_TRAINING_SYNC_MAX_RETRIES))
  ? clamp(Math.round(Number(process.env.RL_TRAINING_SYNC_MAX_RETRIES)), 0, 10)
  : 1;
const RL_TRAINING_RETRY_BACKOFF_MS = Number.isFinite(Number(process.env.RL_TRAINING_RETRY_BACKOFF_MS))
  ? clamp(Math.round(Number(process.env.RL_TRAINING_RETRY_BACKOFF_MS)), 100, 10000)
  : 600;
const RL_TRAINING_CIRCUIT_BREAKER_FAILURE_THRESHOLD = Number.isFinite(Number(process.env.RL_TRAINING_CIRCUIT_BREAKER_FAILURE_THRESHOLD))
  ? clamp(Math.round(Number(process.env.RL_TRAINING_CIRCUIT_BREAKER_FAILURE_THRESHOLD)), 1, 100)
  : 4;
const RL_TRAINING_CIRCUIT_BREAKER_COOLDOWN_MS = Number.isFinite(Number(process.env.RL_TRAINING_CIRCUIT_BREAKER_COOLDOWN_MS))
  ? clamp(Math.round(Number(process.env.RL_TRAINING_CIRCUIT_BREAKER_COOLDOWN_MS)), 1000, 3600000)
  : 120000;
const RL_DEPLOY_MIN_STABILITY_SCORE = Number.isFinite(Number(process.env.RL_DEPLOY_MIN_STABILITY_SCORE))
  ? clamp(Number(process.env.RL_DEPLOY_MIN_STABILITY_SCORE), 0, 1)
  : 0.75;
const RL_DEPLOY_MIN_MEAN_EPISODE_REWARD = Number.isFinite(Number(process.env.RL_DEPLOY_MIN_MEAN_EPISODE_REWARD))
  ? Number(process.env.RL_DEPLOY_MIN_MEAN_EPISODE_REWARD)
  : 1.0;
const RL_DEPLOY_MIN_LAP_TIME_GAIN_MS = Number.isFinite(Number(process.env.RL_DEPLOY_MIN_LAP_TIME_GAIN_MS))
  ? Number(process.env.RL_DEPLOY_MIN_LAP_TIME_GAIN_MS)
  : 1.5;
const RL_DEPLOY_MAX_SYNC_FAILURES = Number.isFinite(Number(process.env.RL_DEPLOY_MAX_SYNC_FAILURES))
  ? clamp(Math.round(Number(process.env.RL_DEPLOY_MAX_SYNC_FAILURES)), 0, 1000)
  : 3;
const HTTP_AUTH_REQUIRED = String(process.env.EVOLUTION_HTTP_AUTH_REQUIRED || 'true').toLowerCase() !== 'false';
const HTTP_REQUIRE_SESSION = String(
  process.env.EVOLUTION_HTTP_REQUIRE_SESSION || process.env.AUTH_REQUIRE_SESSION || 'true'
).toLowerCase() !== 'false';
const HTTP_ENFORCE_PERSISTED_ACL = String(
  process.env.EVOLUTION_HTTP_ENFORCE_PERSISTED_ACL || 'true'
).toLowerCase() !== 'false';
const HTTP_FAIL_ON_ACL_STORE_UNAVAILABLE = String(
  process.env.EVOLUTION_HTTP_FAIL_ON_ACL_STORE_UNAVAILABLE || 'true'
).toLowerCase() !== 'false';

const diffusionClient = createServiceClient('Diffusion Model', DIFFUSION_SERVICE_URL, DIFFUSION_SERVICE_TIMEOUT_MS);
const paretoCache = {
  value: null,
  expires_at_ms: 0,
};
const rlPolicyFallbackRuns = [];
const rlPolicyFallbackActiveByTrack = new Map();
const rlTrainingServiceCircuit = {
  consecutive_failures: 0,
  open_until_ms: 0,
  last_failure_at: null,
  last_error: null,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toRoundedNumber(value, decimals = 4, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Number(numeric.toFixed(decimals));
}

function parseBoundedInteger(value, fallback, minValue, maxValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(Math.round(parsed), minValue, maxValue);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function sleep(ms) {
  const delay = Math.max(0, Math.round(toFiniteNumber(ms, 0)));
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

function isTransientHttpError(error) {
  const status = Number(error?.response?.status);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const code = String(error?.code || '').trim().toUpperCase();
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EHOSTUNREACH']
    .includes(code);
}

function getRlRetryBackoffMs(attemptIndex = 0) {
  const exponent = Math.max(0, Math.round(toFiniteNumber(attemptIndex, 0)));
  return clamp(Math.round(RL_TRAINING_RETRY_BACKOFF_MS * (2 ** exponent)), 100, 20000);
}

function getRlDeploymentGuardrailThresholds() {
  return {
    min_stability_score: RL_DEPLOY_MIN_STABILITY_SCORE,
    min_mean_episode_reward: RL_DEPLOY_MIN_MEAN_EPISODE_REWARD,
    min_lap_time_gain_ms: RL_DEPLOY_MIN_LAP_TIME_GAIN_MS,
    max_sync_failures: RL_DEPLOY_MAX_SYNC_FAILURES,
  };
}

function buildRlTrainerCircuitState() {
  const now = Date.now();
  const openUntilMs = Math.max(0, Math.round(toFiniteNumber(rlTrainingServiceCircuit.open_until_ms, 0)));
  return {
    open: openUntilMs > now,
    open_until_ms: openUntilMs > 0 ? openUntilMs : null,
    open_remaining_ms: Math.max(0, openUntilMs - now),
    consecutive_failures: Math.max(0, Math.round(toFiniteNumber(rlTrainingServiceCircuit.consecutive_failures, 0))),
    failure_threshold: RL_TRAINING_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    cooldown_ms: RL_TRAINING_CIRCUIT_BREAKER_COOLDOWN_MS,
    last_failure_at: rlTrainingServiceCircuit.last_failure_at,
    last_error: rlTrainingServiceCircuit.last_error,
  };
}

function isRlTrainerCircuitOpen() {
  return buildRlTrainerCircuitState().open;
}

function noteRlTrainerServiceSuccess() {
  rlTrainingServiceCircuit.consecutive_failures = 0;
  rlTrainingServiceCircuit.open_until_ms = 0;
  rlTrainingServiceCircuit.last_error = null;
}

function noteRlTrainerServiceFailure(error) {
  rlTrainingServiceCircuit.consecutive_failures = Math.max(
    0,
    Math.round(toFiniteNumber(rlTrainingServiceCircuit.consecutive_failures, 0))
  ) + 1;
  rlTrainingServiceCircuit.last_failure_at = new Date().toISOString();
  rlTrainingServiceCircuit.last_error = String(
    error?.message
    || error?.code
    || error?.response?.status
    || 'rl_training_service_error'
  );

  if (rlTrainingServiceCircuit.consecutive_failures >= RL_TRAINING_CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    rlTrainingServiceCircuit.open_until_ms = Date.now() + RL_TRAINING_CIRCUIT_BREAKER_COOLDOWN_MS;
  }

  return buildRlTrainerCircuitState();
}

function createRlTrainerUnavailableError(reason, details = {}) {
  const message = details.message
    || `RL training service unavailable (${String(reason || 'service_error')})`;
  const error = new Error(message);
  error.code = 'rl_training_service_unavailable';
  error.reason = String(reason || 'service_error');
  error.details = details;
  return error;
}

function evaluateRlDeploymentEligibility(run = {}) {
  const thresholds = getRlDeploymentGuardrailThresholds();
  const status = normalizeRlRunStatus(run.status || 'queued');
  const metrics = run?.metrics && typeof run.metrics === 'object' ? run.metrics : {};
  const serviceJob = run?.config?.service_job && typeof run.config.service_job === 'object'
    ? run.config.service_job
    : {};

  const stabilityScore = Number(metrics.stability_score);
  const meanEpisodeReward = Number(metrics.mean_episode_reward);
  const lapTimeGainMs = Number(metrics.lap_time_gain_ms);
  const syncFailures = parseBoundedInteger(serviceJob.sync_failures, 0, 0, 100000);
  const reasons = [];

  if (status !== 'completed') {
    reasons.push({
      code: 'run_not_completed',
      message: 'Deployment guardrails apply only after run completion.',
    });
  } else {
    if (!Number.isFinite(stabilityScore)) {
      reasons.push({
        code: 'missing_stability_score',
        message: 'stability_score metric is required before deployment.',
      });
    } else if (stabilityScore < thresholds.min_stability_score) {
      reasons.push({
        code: 'stability_score_below_threshold',
        message: `stability_score ${toRoundedNumber(stabilityScore, 6)} is below ${toRoundedNumber(thresholds.min_stability_score, 6)}.`,
      });
    }

    if (!Number.isFinite(meanEpisodeReward)) {
      reasons.push({
        code: 'missing_mean_episode_reward',
        message: 'mean_episode_reward metric is required before deployment.',
      });
    } else if (meanEpisodeReward < thresholds.min_mean_episode_reward) {
      reasons.push({
        code: 'mean_episode_reward_below_threshold',
        message: `mean_episode_reward ${toRoundedNumber(meanEpisodeReward, 6)} is below ${toRoundedNumber(thresholds.min_mean_episode_reward, 6)}.`,
      });
    }

    if (!Number.isFinite(lapTimeGainMs)) {
      reasons.push({
        code: 'missing_lap_time_gain_ms',
        message: 'lap_time_gain_ms metric is required before deployment.',
      });
    } else if (lapTimeGainMs < thresholds.min_lap_time_gain_ms) {
      reasons.push({
        code: 'lap_time_gain_below_threshold',
        message: `lap_time_gain_ms ${toRoundedNumber(lapTimeGainMs, 6)} is below ${toRoundedNumber(thresholds.min_lap_time_gain_ms, 6)}.`,
      });
    }

    if (syncFailures > thresholds.max_sync_failures) {
      reasons.push({
        code: 'sync_failures_above_threshold',
        message: `sync_failures ${syncFailures} exceeds ${thresholds.max_sync_failures}.`,
      });
    }
  }

  const eligible = status === 'completed' && reasons.length === 0;
  return {
    status,
    eligible,
    blocked: status === 'completed' && !eligible,
    reasons,
    thresholds,
    observed: {
      stability_score: Number.isFinite(stabilityScore) ? toRoundedNumber(stabilityScore, 6) : null,
      mean_episode_reward: Number.isFinite(meanEpisodeReward) ? toRoundedNumber(meanEpisodeReward, 6) : null,
      lap_time_gain_ms: Number.isFinite(lapTimeGainMs) ? toRoundedNumber(lapTimeGainMs, 6) : null,
      sync_failures: syncFailures,
    },
    evaluated_at: new Date().toISOString(),
  };
}

function withRlDeploymentGate(run = {}) {
  const evaluation = evaluateRlDeploymentEligibility(run);
  return {
    ...run,
    config: {
      ...(run.config || {}),
      rollout_guardrails: getRlDeploymentGuardrailThresholds(),
      deployment_gate: evaluation,
    },
  };
}

function normalizeTimestamp(value, fallbackDate = new Date()) {
  const parsed = new Date(value || fallbackDate);
  if (!Number.isFinite(parsed.getTime())) {
    return fallbackDate.toISOString();
  }
  return parsed.toISOString();
}

function resolveBackendBaseUrl(req) {
  if (process.env.BACKEND_SELF_URL) {
    return String(process.env.BACKEND_SELF_URL).replace(/\/+$/, '');
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

function isMongoReady() {
  return mongoose?.connection?.readyState === 1 && TelemetryPoint?.db?.readyState === 1;
}

function isRlPolicyMongoReady() {
  return mongoose?.connection?.readyState === 1 && RlPolicyRun?.db?.readyState === 1;
}

function normalizeTrackId(value = 'global') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'global';
}

function hashToUnit(value = '') {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0) / 4294967295;
}

function buildDefaultActionProfile(trackId = 'global') {
  const normalizedTrack = normalizeTrackId(trackId);
  if (normalizedTrack.includes('monza') || normalizedTrack.includes('spa')) {
    return {
      drs_speed_threshold: 255,
      drs_max_yaw_deg: 1.75,
      flap_base_deg: 7.6,
      flap_speed_coeff: 0.012,
      flap_yaw_coeff: 0.45,
      flap_tire_hot_comp_deg: -0.7,
      flap_tire_cold_comp_deg: 0.35,
      flap_low_soc_comp_deg: -0.35,
      flap_high_soc_comp_deg: 0.15,
      ride_base_mm: 0.32,
      ride_yaw_coeff: 0.1,
      ers_base_kw: 205,
      ers_drs_bonus_kw: 30,
      ers_no_drs_penalty_kw: -9,
      ers_soc_coeff: 0.35,
    };
  }

  if (normalizedTrack.includes('monaco') || normalizedTrack.includes('hungaroring')) {
    return {
      drs_speed_threshold: 240,
      drs_max_yaw_deg: 1.35,
      flap_base_deg: 10.2,
      flap_speed_coeff: 0.01,
      flap_yaw_coeff: 0.68,
      flap_tire_hot_comp_deg: -0.9,
      flap_tire_cold_comp_deg: 0.45,
      flap_low_soc_comp_deg: -0.5,
      flap_high_soc_comp_deg: 0.25,
      ride_base_mm: 0.44,
      ride_yaw_coeff: 0.12,
      ers_base_kw: 182,
      ers_drs_bonus_kw: 24,
      ers_no_drs_penalty_kw: -14,
      ers_soc_coeff: 0.28,
    };
  }

  return {
    drs_speed_threshold: 250,
    drs_max_yaw_deg: 1.5,
    flap_base_deg: 8.5,
    flap_speed_coeff: 0.013,
    flap_yaw_coeff: 0.52,
    flap_tire_hot_comp_deg: -0.8,
    flap_tire_cold_comp_deg: 0.4,
    flap_low_soc_comp_deg: -0.45,
    flap_high_soc_comp_deg: 0.2,
    ride_base_mm: 0.4,
    ride_yaw_coeff: 0.11,
    ers_base_kw: 190,
    ers_drs_bonus_kw: 35,
    ers_no_drs_penalty_kw: -12,
    ers_soc_coeff: 0.3,
  };
}

function normalizeActionProfile(trackId, profile = {}) {
  const defaults = buildDefaultActionProfile(trackId);
  return {
    drs_speed_threshold: clamp(toFiniteNumber(profile.drs_speed_threshold, defaults.drs_speed_threshold), 180, 340),
    drs_max_yaw_deg: clamp(toFiniteNumber(profile.drs_max_yaw_deg, defaults.drs_max_yaw_deg), 0.5, 4),
    flap_base_deg: clamp(toFiniteNumber(profile.flap_base_deg, defaults.flap_base_deg), 2, 15),
    flap_speed_coeff: clamp(toFiniteNumber(profile.flap_speed_coeff, defaults.flap_speed_coeff), 0.001, 0.05),
    flap_yaw_coeff: clamp(toFiniteNumber(profile.flap_yaw_coeff, defaults.flap_yaw_coeff), 0.01, 2),
    flap_tire_hot_comp_deg: clamp(
      toFiniteNumber(profile.flap_tire_hot_comp_deg, defaults.flap_tire_hot_comp_deg),
      -2.5,
      2.5
    ),
    flap_tire_cold_comp_deg: clamp(
      toFiniteNumber(profile.flap_tire_cold_comp_deg, defaults.flap_tire_cold_comp_deg),
      -2.5,
      2.5
    ),
    flap_low_soc_comp_deg: clamp(
      toFiniteNumber(profile.flap_low_soc_comp_deg, defaults.flap_low_soc_comp_deg),
      -2.5,
      2.5
    ),
    flap_high_soc_comp_deg: clamp(
      toFiniteNumber(profile.flap_high_soc_comp_deg, defaults.flap_high_soc_comp_deg),
      -2.5,
      2.5
    ),
    ride_base_mm: clamp(toFiniteNumber(profile.ride_base_mm, defaults.ride_base_mm), -2.5, 2.5),
    ride_yaw_coeff: clamp(toFiniteNumber(profile.ride_yaw_coeff, defaults.ride_yaw_coeff), 0.01, 0.8),
    ers_base_kw: clamp(toFiniteNumber(profile.ers_base_kw, defaults.ers_base_kw), 80, 350),
    ers_drs_bonus_kw: clamp(toFiniteNumber(profile.ers_drs_bonus_kw, defaults.ers_drs_bonus_kw), 0, 120),
    ers_no_drs_penalty_kw: clamp(
      toFiniteNumber(profile.ers_no_drs_penalty_kw, defaults.ers_no_drs_penalty_kw),
      -120,
      0
    ),
    ers_soc_coeff: clamp(toFiniteNumber(profile.ers_soc_coeff, defaults.ers_soc_coeff), 0, 2.5),
  };
}

function normalizeRlTrainingConfig(payload = {}) {
  return {
    episodes: parseBoundedInteger(payload.episodes, 600, 10, 50000),
    horizon_steps: parseBoundedInteger(payload.horizon_steps, 2500, 100, 20000),
    batch_size: parseBoundedInteger(payload.batch_size, 256, 16, 4096),
    eval_episodes: parseBoundedInteger(payload.eval_episodes, 50, 5, 1000),
    seed: parseBoundedInteger(payload.seed, 42, 1, 100000),
    gamma: toRoundedNumber(clamp(toFiniteNumber(payload.gamma, 0.997), 0.8, 0.99999), 6),
    gae_lambda: toRoundedNumber(clamp(toFiniteNumber(payload.gae_lambda, 0.95), 0.8, 0.999), 6),
    clip_ratio: toRoundedNumber(clamp(toFiniteNumber(payload.clip_ratio, 0.2), 0.05, 0.4), 4),
    learning_rate: toRoundedNumber(clamp(toFiniteNumber(payload.learning_rate, 0.0003), 0.000001, 0.01), 7),
    entropy_coef: toRoundedNumber(clamp(toFiniteNumber(payload.entropy_coef, 0.01), 0, 0.2), 5),
    target_style: String(payload.target_style || 'balanced').trim().toLowerCase(),
  };
}

function normalizeRlRunStatus(rawStatus = 'queued') {
  const normalized = String(rawStatus || '').trim().toLowerCase();
  if (['queued', 'pending', 'created', 'submitted', 'waiting'].includes(normalized)) return 'queued';
  if (['running', 'in_progress', 'active', 'processing'].includes(normalized)) return 'running';
  if (['completed', 'success', 'succeeded', 'done', 'finished'].includes(normalized)) return 'completed';
  if (['failed', 'error', 'cancelled', 'canceled', 'timeout'].includes(normalized)) return 'failed';
  return 'queued';
}

function resolveRlStatusEndpoint(jobId, statusEndpointRaw = '') {
  const statusEndpoint = String(statusEndpointRaw || '').trim();
  if (statusEndpoint) {
    if (statusEndpoint.startsWith('http://') || statusEndpoint.startsWith('https://')) {
      return statusEndpoint;
    }
    return `${String(RL_TRAINING_SERVICE_URL).replace(/\/+$/, '')}${statusEndpoint.startsWith('/') ? '' : '/'}${statusEndpoint}`;
  }

  const template = String(RL_TRAINING_STATUS_ENDPOINT || '/api/v1/rl/jobs/:job_id');
  const replaced = template
    .replace(':job_id', encodeURIComponent(String(jobId || '')))
    .replace(':jobId', encodeURIComponent(String(jobId || '')));
  return `${String(RL_TRAINING_SERVICE_URL).replace(/\/+$/, '')}${replaced.startsWith('/') ? '' : '/'}${replaced}`;
}

function normalizeRlServiceMetrics(payload = {}, fallback = {}) {
  const metricsPayload = payload?.metrics && typeof payload.metrics === 'object'
    ? payload.metrics
    : ((payload?.result?.metrics && typeof payload.result.metrics === 'object') ? payload.result.metrics : {});
  const merged = {
    ...(fallback && typeof fallback === 'object' ? fallback : {}),
    ...metricsPayload,
  };

  const meanReward = toFiniteNumber(
    merged.mean_episode_reward ?? merged.avg_reward ?? merged.average_reward,
    merged.mean_episode_reward
  );
  if (Number.isFinite(meanReward)) {
    merged.mean_episode_reward = toRoundedNumber(meanReward, 6);
  }

  const bestReward = toFiniteNumber(merged.best_episode_reward ?? merged.best_reward, merged.best_episode_reward);
  if (Number.isFinite(bestReward)) {
    merged.best_episode_reward = toRoundedNumber(bestReward, 6);
  }

  const lapGain = toFiniteNumber(
    merged.lap_time_gain_ms ?? merged.expected_lap_gain_ms ?? merged.lap_gain_ms,
    merged.lap_time_gain_ms
  );
  if (Number.isFinite(lapGain)) {
    merged.lap_time_gain_ms = toRoundedNumber(lapGain, 6);
  }

  const stability = toFiniteNumber(merged.stability_score ?? merged.policy_stability, merged.stability_score);
  if (Number.isFinite(stability)) {
    merged.stability_score = toRoundedNumber(clamp(stability, 0, 1), 6);
  }

  const progressPercent = toFiniteNumber(
    payload?.progress_percent ?? payload?.progress ?? merged.progress_percent,
    merged.progress_percent
  );
  if (Number.isFinite(progressPercent)) {
    merged.progress_percent = toRoundedNumber(clamp(progressPercent, 0, 100), 4);
  }

  const queuePosition = toFiniteNumber(payload?.queue_position ?? merged.queue_position, merged.queue_position);
  if (Number.isFinite(queuePosition)) {
    merged.queue_position = Math.max(0, Math.round(queuePosition));
  }

  return merged;
}

function buildServiceBackedRlRun({
  trackId,
  policyName,
  trainingConfig,
  servicePayload = {},
  autoDeploy = true,
}) {
  const normalizedTrack = normalizeTrackId(trackId);
  const now = new Date();
  const providerJobId = String(
    servicePayload.job_id
    || servicePayload.training_job_id
    || servicePayload.provider_job_id
    || servicePayload.id
    || ''
  ).trim();
  const status = normalizeRlRunStatus(servicePayload.status || servicePayload.state || 'queued');
  const statusEndpoint = providerJobId
    ? resolveRlStatusEndpoint(providerJobId, servicePayload.status_endpoint || servicePayload.status_url)
    : null;
  const actionProfilePayload = servicePayload.action_profile || servicePayload.result?.action_profile || {};
  const actionProfile = normalizeActionProfile(normalizedTrack, actionProfilePayload);

  const run = {
    run_id: String(servicePayload.run_id || `rl_run_${randomUUID()}`),
    track_id: normalizedTrack,
    policy_name: String(policyName || servicePayload.policy_name || `ppo-active-control-${normalizedTrack}`).trim(),
    status,
    source: 'sb3-service',
    created_at: normalizeTimestamp(servicePayload.created_at || now),
    started_at: normalizeTimestamp(
      servicePayload.started_at || (['running', 'completed'].includes(status) ? now : servicePayload.created_at || now)
    ),
    completed_at: status === 'completed'
      ? normalizeTimestamp(servicePayload.completed_at || now)
      : null,
    duration_ms: 0,
    config: {
      ...trainingConfig,
      auto_deploy_on_complete: Boolean(autoDeploy),
      rollout_guardrails: getRlDeploymentGuardrailThresholds(),
      service_job: {
        provider: String(servicePayload.provider || 'sb3-service'),
        job_id: providerJobId || null,
        status_endpoint: statusEndpoint,
        submit_endpoint: RL_TRAINING_SUBMIT_ENDPOINT,
        service_base_url: RL_TRAINING_SERVICE_URL,
        provider_state: String(servicePayload.status || servicePayload.state || status),
        queue_position: Number.isFinite(Number(servicePayload.queue_position))
          ? Math.max(0, Math.round(Number(servicePayload.queue_position)))
          : null,
        progress_percent: Number.isFinite(Number(servicePayload.progress_percent ?? servicePayload.progress))
          ? clamp(Number(servicePayload.progress_percent ?? servicePayload.progress), 0, 100)
          : (status === 'completed' ? 100 : 0),
        submit_attempts: Number.isFinite(Number(servicePayload.submit_attempts))
          ? Math.max(1, Math.round(Number(servicePayload.submit_attempts)))
          : 1,
        last_sync_at: now.toISOString(),
        sync_interval_ms: RL_TRAINING_SYNC_INTERVAL_MS,
        last_error: null,
        sync_failures: 0,
      },
    },
    metrics: normalizeRlServiceMetrics(servicePayload, {
      episodes: trainingConfig.episodes,
      eval_episodes: trainingConfig.eval_episodes,
      progress_percent: status === 'completed' ? 100 : 0,
    }),
    action_profile: actionProfile,
    deployment: {
      active: false,
      activated_at: null,
      deactivated_at: null,
      environment: process.env.OBS_ENV_PROFILE || process.env.NODE_ENV || 'dev',
    },
  };

  if (status === 'completed') {
    const createdMs = new Date(run.created_at).getTime();
    const completedMs = run.completed_at ? new Date(run.completed_at).getTime() : Date.now();
    run.duration_ms = Math.max(0, Math.round(completedMs - createdMs));
  }

  return run;
}

async function submitRlTrainingJob({
  req,
  trackId,
  policyName,
  trainingConfig,
  autoDeploy,
}) {
  const circuit = buildRlTrainerCircuitState();
  if (circuit.open) {
    throw createRlTrainerUnavailableError('circuit_open', {
      message: 'RL training service circuit breaker is open.',
      service_url: RL_TRAINING_SERVICE_URL,
      submit_endpoint: RL_TRAINING_SUBMIT_ENDPOINT,
      circuit,
    });
  }

  const endpoint = `${String(RL_TRAINING_SERVICE_URL).replace(/\/+$/, '')}${RL_TRAINING_SUBMIT_ENDPOINT.startsWith('/') ? '' : '/'}${RL_TRAINING_SUBMIT_ENDPOINT}`;
  const requestPayload = {
    track_id: trackId,
    policy_name: policyName,
    algorithm: 'ppo',
    framework: 'stable-baselines3',
    auto_deploy: Boolean(autoDeploy),
    config: trainingConfig,
  };

  for (let attempt = 0; attempt <= RL_TRAINING_SUBMIT_MAX_RETRIES; attempt += 1) {
    try {
      const response = await axios.post(endpoint, requestPayload, {
        timeout: RL_TRAINING_TIMEOUT_MS,
        headers: req?.requestId ? { 'x-request-id': req.requestId } : undefined,
      });
      noteRlTrainerServiceSuccess();
      const payload = response?.data?.data || response?.data || {};
      const run = buildServiceBackedRlRun({
        trackId,
        policyName,
        trainingConfig,
        servicePayload: {
          ...payload,
          submit_attempts: attempt + 1,
        },
        autoDeploy,
      });
      return withRlDeploymentGate(run);
    } catch (error) {
      const transient = isTransientHttpError(error);
      const canRetry = transient && attempt < RL_TRAINING_SUBMIT_MAX_RETRIES;
      if (canRetry) {
        await sleep(getRlRetryBackoffMs(attempt));
        continue;
      }

      const nextCircuit = noteRlTrainerServiceFailure(error);
      throw createRlTrainerUnavailableError(nextCircuit.open ? 'circuit_opened' : 'service_error', {
        message: error?.message || 'RL training submit failed',
        service_url: RL_TRAINING_SERVICE_URL,
        submit_endpoint: RL_TRAINING_SUBMIT_ENDPOINT,
        status: Number(error?.response?.status) || null,
        code: error?.code || null,
        transient,
        submit_attempts: attempt + 1,
        circuit: nextCircuit,
      });
    }
  }

  const nextCircuit = noteRlTrainerServiceFailure(new Error('RL training submit exhausted retries'));
  throw createRlTrainerUnavailableError(nextCircuit.open ? 'circuit_opened' : 'service_error', {
    message: 'RL training submit exhausted retries',
    service_url: RL_TRAINING_SERVICE_URL,
    submit_endpoint: RL_TRAINING_SUBMIT_ENDPOINT,
    submit_attempts: RL_TRAINING_SUBMIT_MAX_RETRIES + 1,
    circuit: nextCircuit,
  });
}

async function syncRlPolicyRunState(run, {
  force = false,
} = {}) {
  if (!run) {
    return null;
  }
  const normalizedRun = toRlPolicyContract(run);
  const status = normalizeRlRunStatus(normalizedRun.status);
  const shouldSync = ['queued', 'running'].includes(status);
  if (!force && !shouldSync) {
    return normalizedRun;
  }

  const serviceJob = normalizedRun?.config?.service_job || {};
  const providerJobId = String(serviceJob.job_id || '').trim();
  if (!providerJobId) {
    return normalizedRun;
  }

  const endpoint = resolveRlStatusEndpoint(providerJobId, serviceJob.status_endpoint);
  try {
    let response;
    let syncAttempts = 0;
    let lastSyncError;
    for (let attempt = 0; attempt <= RL_TRAINING_SYNC_MAX_RETRIES; attempt += 1) {
      syncAttempts = attempt + 1;
      try {
        response = await axios.get(endpoint, {
          timeout: RL_TRAINING_TIMEOUT_MS,
        });
        noteRlTrainerServiceSuccess();
        break;
      } catch (syncError) {
        lastSyncError = syncError;
        const transient = isTransientHttpError(syncError);
        const canRetry = transient && attempt < RL_TRAINING_SYNC_MAX_RETRIES;
        if (canRetry) {
          await sleep(getRlRetryBackoffMs(attempt));
          continue;
        }
      }
    }

    if (!response) {
      throw lastSyncError || new Error('RL training status sync failed');
    }

    const payload = response?.data?.data || response?.data || {};
    const nextStatus = normalizeRlRunStatus(payload.status || payload.state || normalizedRun.status);
    const nowIso = new Date().toISOString();
    const actionProfile = normalizeActionProfile(
      normalizedRun.track_id,
      payload.action_profile || payload.result?.action_profile || normalizedRun.action_profile
    );

    const updated = {
      ...normalizedRun,
      status: nextStatus,
      source: normalizedRun.source || 'sb3-service',
      started_at: normalizedRun.started_at || normalizeTimestamp(payload.started_at || normalizedRun.created_at || nowIso),
      completed_at: nextStatus === 'completed' || nextStatus === 'failed'
        ? normalizeTimestamp(payload.completed_at || nowIso)
        : null,
      metrics: normalizeRlServiceMetrics(payload, normalizedRun.metrics || {}),
      action_profile: actionProfile,
      config: {
        ...(normalizedRun.config || {}),
        service_job: {
          ...(normalizedRun.config?.service_job || {}),
          job_id: providerJobId,
          status_endpoint: endpoint,
          provider_state: String(payload.status || payload.state || nextStatus),
          queue_position: Number.isFinite(Number(payload.queue_position))
            ? Math.max(0, Math.round(Number(payload.queue_position)))
            : (normalizedRun.config?.service_job?.queue_position ?? null),
          progress_percent: Number.isFinite(Number(payload.progress_percent ?? payload.progress))
            ? clamp(Number(payload.progress_percent ?? payload.progress), 0, 100)
            : (nextStatus === 'completed'
              ? 100
              : (normalizedRun.config?.service_job?.progress_percent ?? 0)),
          sync_attempts: syncAttempts,
          last_sync_at: nowIso,
          last_error: null,
          sync_failures: 0,
        },
      },
    };

    if (nextStatus === 'completed' || nextStatus === 'failed') {
      const startedMs = new Date(updated.started_at || updated.created_at).getTime();
      const completedMs = new Date(updated.completed_at || nowIso).getTime();
      updated.duration_ms = Math.max(0, Math.round(completedMs - startedMs));
    }

    const persisted = await persistRlPolicyRun(withRlDeploymentGate(updated));
    const deploymentGate = persisted?.config?.deployment_gate || evaluateRlDeploymentEligibility(persisted);
    if (persisted.status === 'completed' && parseBoolean(persisted.config?.auto_deploy_on_complete, false)) {
      if (deploymentGate.eligible) {
        await setActiveRlPolicyRun(persisted.run_id, persisted.track_id);
        return getRlPolicyRunById(persisted.run_id);
      }
      logger.warn(`RL policy deployment blocked by guardrails for run ${persisted.run_id}`);
    }
    return persisted;
  } catch (error) {
    const circuit = noteRlTrainerServiceFailure(error);
    const syncFailures = Math.max(
      0,
      parseBoundedInteger(normalizedRun?.config?.service_job?.sync_failures, 0, 0, 10000)
    ) + 1;
    const degraded = {
      ...normalizedRun,
      config: {
        ...(normalizedRun.config || {}),
        service_job: {
          ...(normalizedRun.config?.service_job || {}),
          job_id: providerJobId,
          status_endpoint: endpoint,
          last_sync_at: new Date().toISOString(),
          last_error: String(error?.message || 'sync_failed'),
          sync_failures: syncFailures,
          circuit_open: Boolean(circuit.open),
        },
      },
      metrics: {
        ...(normalizedRun.metrics || {}),
        sync_failures: syncFailures,
      },
    };
    return persistRlPolicyRun(degraded);
  }
}

function buildSyntheticRlRun({ trackId, config, policyName, autoDeploy = true }) {
  const normalizedTrack = normalizeTrackId(trackId);
  const trainingConfig = normalizeRlTrainingConfig(config);
  const runId = `rl_run_${randomUUID()}`;
  const startedAt = new Date();

  const trackBias = hashToUnit(normalizedTrack);
  const styleBias = hashToUnit(trainingConfig.target_style);
  const seedBias = hashToUnit(`${trainingConfig.seed}-${trainingConfig.episodes}`);
  const qualityBias = (trackBias * 0.32) + (styleBias * 0.38) + (seedBias * 0.3);

  const baseReward = 1.1 + (trainingConfig.episodes / 5000) + qualityBias * 1.6;
  const bestReward = baseReward + 0.35 + qualityBias * 0.55;
  const lapGainMs = clamp(6 + qualityBias * 18 + (trainingConfig.eval_episodes / 100), 2.5, 38);
  const stabilityScore = clamp(0.78 + qualityBias * 0.18, 0.45, 0.99);

  const baseline = buildDefaultActionProfile(normalizedTrack);
  const styleOffset = trainingConfig.target_style === 'aggressive'
    ? 1
    : trainingConfig.target_style === 'conservative'
      ? -1
      : 0;
  const actionProfile = normalizeActionProfile(normalizedTrack, {
    flap_base_deg: baseline.flap_base_deg + styleOffset * 0.7 + (qualityBias - 0.5) * 1.2,
    drs_speed_threshold: baseline.drs_speed_threshold - styleOffset * 6 + (0.5 - qualityBias) * 10,
    drs_max_yaw_deg: baseline.drs_max_yaw_deg + styleOffset * 0.08 + (qualityBias - 0.5) * 0.12,
    ers_base_kw: baseline.ers_base_kw + styleOffset * 8 + (qualityBias - 0.5) * 10,
    ers_drs_bonus_kw: baseline.ers_drs_bonus_kw + styleOffset * 4,
    ers_soc_coeff: baseline.ers_soc_coeff + (qualityBias - 0.5) * 0.08,
    flap_speed_coeff: baseline.flap_speed_coeff + (0.5 - qualityBias) * 0.002,
    flap_yaw_coeff: baseline.flap_yaw_coeff + (qualityBias - 0.5) * 0.15,
  });

  const durationMs = Math.round(
    1800
    + (trainingConfig.episodes * 1.1)
    + (trainingConfig.horizon_steps * 0.07)
    + (trainingConfig.batch_size * 0.45)
  );
  const completedAt = new Date(startedAt.getTime() + durationMs);

  return {
    run_id: runId,
    track_id: normalizedTrack,
    policy_name: String(policyName || 'ppo-active-control-v1'),
    status: 'completed',
    source: 'synthetic-fallback',
    created_at: startedAt.toISOString(),
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: durationMs,
    config: {
      ...trainingConfig,
      auto_deploy_on_complete: Boolean(autoDeploy),
      rollout_guardrails: getRlDeploymentGuardrailThresholds(),
    },
    metrics: {
      episodes: trainingConfig.episodes,
      eval_episodes: trainingConfig.eval_episodes,
      mean_episode_reward: toRoundedNumber(baseReward, 5),
      best_episode_reward: toRoundedNumber(bestReward, 5),
      lap_time_gain_ms: toRoundedNumber(lapGainMs, 4),
      stability_score: toRoundedNumber(stabilityScore, 5),
      convergence_epoch: parseBoundedInteger(trainingConfig.episodes * (0.55 + (1 - qualityBias) * 0.2), 1, 1, trainingConfig.episodes),
      policy_entropy: toRoundedNumber(clamp(0.02 + (1 - qualityBias) * 0.04, 0.005, 0.12), 5),
    },
    action_profile: actionProfile,
    deployment: {
      active: false,
      activated_at: null,
      deactivated_at: null,
      environment: process.env.OBS_ENV_PROFILE || process.env.NODE_ENV || 'dev',
    },
  };
}

function toRlPolicyContract(run = {}) {
  const trackId = normalizeTrackId(run.track_id);
  const actionProfile = normalizeActionProfile(trackId, run.action_profile || {});
  const metrics = run.metrics && typeof run.metrics === 'object' ? run.metrics : {};
  const config = run.config && typeof run.config === 'object' ? run.config : {};
  const deployment = run.deployment && typeof run.deployment === 'object' ? run.deployment : {};
  const status = normalizeRlRunStatus(run.status || 'queued');
  const completedAt = (status === 'completed' || status === 'failed')
    ? normalizeTimestamp(run.completed_at || run.started_at || run.created_at)
    : (run.completed_at ? normalizeTimestamp(run.completed_at) : null);

  return {
    run_id: String(run.run_id || `rl_run_${randomUUID()}`),
    track_id: trackId,
    policy_name: String(run.policy_name || 'ppo-active-control-v1'),
    status,
    source: String(run.source || 'sb3-service'),
    created_at: normalizeTimestamp(run.created_at),
    started_at: normalizeTimestamp(run.started_at || run.created_at),
    completed_at: completedAt,
    duration_ms: parseBoundedInteger(run.duration_ms, 0, 0, 3_600_000),
    config,
    metrics,
    action_profile: actionProfile,
    deployment: {
      active: Boolean(deployment.active),
      activated_at: deployment.activated_at ? normalizeTimestamp(deployment.activated_at) : null,
      deactivated_at: deployment.deactivated_at ? normalizeTimestamp(deployment.deactivated_at) : null,
      environment: String(deployment.environment || process.env.NODE_ENV || 'dev'),
    },
  };
}

function pruneRlFallbackRuns() {
  if (rlPolicyFallbackRuns.length > RL_POLICY_MAX_RUNS) {
    rlPolicyFallbackRuns.splice(0, rlPolicyFallbackRuns.length - RL_POLICY_MAX_RUNS);
  }
}

async function persistRlPolicyRun(run) {
  const normalized = toRlPolicyContract(run);
  if (isRlPolicyMongoReady()) {
    const persisted = await RlPolicyRun.findOneAndUpdate(
      { run_id: normalized.run_id },
      { $set: normalized },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    ).lean();
    return toRlPolicyContract(persisted || normalized);
  }

  const existingIndex = rlPolicyFallbackRuns.findIndex((entry) => entry.run_id === normalized.run_id);
  if (existingIndex >= 0) {
    rlPolicyFallbackRuns[existingIndex] = normalized;
  } else {
    rlPolicyFallbackRuns.push(normalized);
  }
  pruneRlFallbackRuns();
  return normalized;
}

async function setActiveRlPolicyRun(runId, trackId) {
  const normalizedTrack = normalizeTrackId(trackId);

  if (isRlPolicyMongoReady()) {
    await RlPolicyRun.updateMany(
      { track_id: normalizedTrack, 'deployment.active': true },
      {
        $set: {
          'deployment.active': false,
          'deployment.deactivated_at': new Date(),
        },
      }
    );

    await RlPolicyRun.updateOne(
      { run_id: runId },
      {
        $set: {
          'deployment.active': true,
          'deployment.activated_at': new Date(),
          'deployment.deactivated_at': null,
          'deployment.environment': process.env.OBS_ENV_PROFILE || process.env.NODE_ENV || 'dev',
        },
      }
    );
    return;
  }

  rlPolicyFallbackRuns.forEach((entry) => {
    if (normalizeTrackId(entry.track_id) === normalizedTrack && entry.deployment?.active) {
      entry.deployment.active = false;
      entry.deployment.deactivated_at = new Date().toISOString();
    }
    if (entry.run_id === runId) {
      entry.deployment = {
        ...(entry.deployment || {}),
        active: true,
        activated_at: new Date().toISOString(),
        deactivated_at: null,
        environment: process.env.OBS_ENV_PROFILE || process.env.NODE_ENV || 'dev',
      };
    }
  });
  rlPolicyFallbackActiveByTrack.set(normalizedTrack, runId);
}

async function getRlPolicyRunById(runId) {
  const normalizedRunId = String(runId || '').trim();
  if (!normalizedRunId) {
    return null;
  }

  if (isRlPolicyMongoReady()) {
    const run = await RlPolicyRun.findOne({ run_id: normalizedRunId }).lean();
    return run ? toRlPolicyContract(run) : null;
  }

  const run = rlPolicyFallbackRuns.find((entry) => entry.run_id === normalizedRunId) || null;
  return run ? toRlPolicyContract(run) : null;
}

async function listRlPolicyRuns({
  trackId,
  status = 'completed',
  limit = 10,
} = {}) {
  const resolvedLimit = parseBoundedInteger(limit, 10, 1, 200);
  const normalizedTrack = trackId ? normalizeTrackId(trackId) : null;
  const normalizedStatusRaw = status ? String(status).trim().toLowerCase() : null;
  const normalizedStatus = !normalizedStatusRaw || ['all', '*'].includes(normalizedStatusRaw)
    ? null
    : normalizedStatusRaw;

  if (isRlPolicyMongoReady()) {
    const query = {};
    if (normalizedTrack) {
      query.track_id = normalizedTrack;
    }
    if (normalizedStatus) {
      query.status = normalizedStatus;
    }
    const runs = await RlPolicyRun.find(query)
      .sort({ completed_at: -1, created_at: -1 })
      .limit(resolvedLimit)
      .lean();
    return runs.map((entry) => toRlPolicyContract(entry));
  }

  return rlPolicyFallbackRuns
    .filter((entry) => {
      if (normalizedTrack && normalizeTrackId(entry.track_id) !== normalizedTrack) {
        return false;
      }
      if (normalizedStatus && String(entry.status || '').toLowerCase() !== normalizedStatus) {
        return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime())
    .slice(0, resolvedLimit)
    .map((entry) => toRlPolicyContract(entry));
}

async function resolveRlPolicyForTrack(trackId) {
  const normalizedTrack = normalizeTrackId(trackId);
  const trackRuns = await listRlPolicyRuns({
    trackId: normalizedTrack,
    status: 'completed',
    limit: 12,
  });

  const activeTrackRun = trackRuns.find((run) => run.deployment?.active);
  if (activeTrackRun) {
    return {
      policy: activeTrackRun,
      source: 'trained-policy',
    };
  }
  if (trackRuns.length > 0) {
    return {
      policy: trackRuns[0],
      source: 'latest-track-policy',
    };
  }

  if (normalizedTrack !== 'global') {
    const globalRuns = await listRlPolicyRuns({
      trackId: 'global',
      status: 'completed',
      limit: 12,
    });
    const activeGlobalRun = globalRuns.find((run) => run.deployment?.active);
    if (activeGlobalRun) {
      return {
        policy: activeGlobalRun,
        source: 'global-trained-policy',
      };
    }
    if (globalRuns.length > 0) {
      return {
        policy: globalRuns[0],
        source: 'global-latest-policy',
      };
    }
  }

  return {
    policy: {
      run_id: 'proxy-default',
      track_id: normalizedTrack,
      policy_name: 'ppo-active-control-proxy',
      status: 'completed',
      source: 'rule-proxy',
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 0,
      config: {
        target_style: 'balanced',
      },
      metrics: {
        mean_episode_reward: null,
        lap_time_gain_ms: null,
      },
      action_profile: normalizeActionProfile(normalizedTrack, {}),
      deployment: {
        active: false,
        activated_at: null,
        deactivated_at: null,
        environment: process.env.NODE_ENV || 'dev',
      },
    },
    source: 'proxy-default',
  };
}

function ensureFallbackBuffer(carId) {
  if (!telemetryFallbackStore.has(carId)) {
    telemetryFallbackStore.set(carId, []);
  }
  return telemetryFallbackStore.get(carId);
}

function toTelemetryContractPoint(point = {}) {
  return {
    telemetry_id: String(point.telemetry_id || randomUUID()),
    car_id: String(point.car_id || 'car-44'),
    source: String(point.source || 'api'),
    timestamp: normalizeTimestamp(point.timestamp),
    lap: parseBoundedInteger(point.lap, 0, 0, 250),
    sector: parseBoundedInteger(point.sector, 1, 1, 3),
    speed_kph: toRoundedNumber(point.speed_kph, 3, 0),
    yaw_deg: toRoundedNumber(point.yaw_deg, 4, 0),
    downforce_n: toRoundedNumber(point.downforce_n, 3, 0),
    drag_n: toRoundedNumber(point.drag_n, 3, 0),
    battery_soc: toRoundedNumber(point.battery_soc, 3, 0),
    ers_deploy_kw: toRoundedNumber(point.ers_deploy_kw, 3, 0),
    drs_open: Boolean(point.drs_open),
    track_temp_c: toRoundedNumber(point.track_temp_c, 3, 30),
    anomalies: Array.isArray(point.anomalies) ? point.anomalies : [],
  };
}

async function countTelemetryPoints(carId) {
  if (isMongoReady()) {
    return TelemetryPoint.countDocuments({ car_id: carId });
  }
  return ensureFallbackBuffer(carId).length;
}

async function getLatestTelemetryPoint(carId) {
  if (isMongoReady()) {
    const latest = await TelemetryPoint.findOne({ car_id: carId })
      .sort({ timestamp: -1 })
      .lean();
    return latest ? toTelemetryContractPoint(latest) : null;
  }

  const buffer = ensureFallbackBuffer(carId);
  return buffer.length > 0 ? toTelemetryContractPoint(buffer[buffer.length - 1]) : null;
}

async function listRecentTelemetryPoints(carId, limit) {
  if (isMongoReady()) {
    const records = await TelemetryPoint.find({ car_id: carId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    return records.reverse().map((record) => toTelemetryContractPoint(record));
  }

  const buffer = ensureFallbackBuffer(carId);
  return buffer.slice(-limit).map((record) => toTelemetryContractPoint(record));
}

async function persistTelemetryPoint(point) {
  const normalizedPoint = toTelemetryContractPoint(point);
  if (isMongoReady()) {
    const record = await TelemetryPoint.findOneAndUpdate(
      { telemetry_id: normalizedPoint.telemetry_id },
      { $set: normalizedPoint },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    ).lean();
    return toTelemetryContractPoint(record || normalizedPoint);
  }

  const buffer = ensureFallbackBuffer(normalizedPoint.car_id);
  buffer.push(normalizedPoint);
  if (buffer.length > TELEMETRY_MAX_POINTS) {
    buffer.splice(0, buffer.length - TELEMETRY_MAX_POINTS);
  }
  return normalizedPoint;
}

async function trimTelemetryPoints(carId, maxPoints = TELEMETRY_MAX_POINTS) {
  if (isMongoReady()) {
    const overflow = await TelemetryPoint.find({ car_id: carId })
      .sort({ timestamp: -1 })
      .skip(maxPoints)
      .select({ _id: 1 })
      .lean();

    if (overflow.length > 0) {
      const ids = overflow.map((item) => item._id);
      await TelemetryPoint.deleteMany({ _id: { $in: ids } });
    }
    return;
  }

  const buffer = ensureFallbackBuffer(carId);
  if (buffer.length > maxPoints) {
    buffer.splice(0, buffer.length - maxPoints);
  }
}

function collectAnomalies(currentPoint, previousPoint) {
  const anomalies = [];
  if (currentPoint.speed_kph > 390) {
    anomalies.push('speed_outlier');
  }
  if (currentPoint.downforce_n < 0 || currentPoint.drag_n < 0) {
    anomalies.push('negative_force_value');
  }
  if (currentPoint.battery_soc < 0 || currentPoint.battery_soc > 100) {
    anomalies.push('battery_soc_out_of_range');
  }

  if (previousPoint) {
    const dt = Math.max(
      (new Date(currentPoint.timestamp).getTime() - new Date(previousPoint.timestamp).getTime()) / 1000,
      0.001
    );
    const speedRate = Math.abs(currentPoint.speed_kph - previousPoint.speed_kph) / dt;
    if (speedRate > 120) {
      anomalies.push('speed_transition_spike');
    }
  }

  return anomalies;
}

function summarizeTelemetry(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return {
      count: 0,
      avg_speed_kph: 0,
      peak_speed_kph: 0,
      avg_downforce_n: 0,
      avg_drag_n: 0,
      avg_efficiency: 0,
      drs_open_ratio: 0,
      anomaly_count: 0,
    };
  }

  const aggregate = points.reduce((acc, point) => {
    acc.speed += toFiniteNumber(point.speed_kph, 0);
    acc.downforce += toFiniteNumber(point.downforce_n, 0);
    acc.drag += toFiniteNumber(point.drag_n, 0);
    acc.efficiency += toFiniteNumber(point.downforce_n, 0) / Math.max(toFiniteNumber(point.drag_n, 0), 1e-6);
    acc.peakSpeed = Math.max(acc.peakSpeed, toFiniteNumber(point.speed_kph, 0));
    if (point.drs_open) acc.drsOpen += 1;
    acc.anomalies += Array.isArray(point.anomalies) ? point.anomalies.length : 0;
    return acc;
  }, {
    speed: 0,
    downforce: 0,
    drag: 0,
    efficiency: 0,
    peakSpeed: 0,
    drsOpen: 0,
    anomalies: 0,
  });

  const n = points.length;
  return {
    count: n,
    avg_speed_kph: toRoundedNumber(aggregate.speed / n, 3),
    peak_speed_kph: toRoundedNumber(aggregate.peakSpeed, 3),
    avg_downforce_n: toRoundedNumber(aggregate.downforce / n, 3),
    avg_drag_n: toRoundedNumber(aggregate.drag / n, 3),
    avg_efficiency: toRoundedNumber(aggregate.efficiency / n, 4),
    drs_open_ratio: toRoundedNumber(aggregate.drsOpen / n, 4),
    anomaly_count: aggregate.anomalies,
  };
}

function parseCarIdsQuery(rawValue) {
  if (!rawValue) return [];
  const source = Array.isArray(rawValue) ? rawValue.join(',') : String(rawValue);
  return [...new Set(
    source
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )].slice(0, 20);
}

function normalizeAllowedCarIds(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => String(value || '').trim()).filter(Boolean);
  }
  if (typeof rawValue === 'string') {
    return rawValue.split(',').map((value) => value.trim()).filter(Boolean);
  }
  if (rawValue && typeof rawValue === 'object') {
    return Object.values(rawValue).map((value) => String(value || '').trim()).filter(Boolean);
  }
  if (rawValue) {
    return [String(rawValue).trim()].filter(Boolean);
  }
  return [];
}

function getAllowedCarsFromAuthContext(authContext = {}) {
  const role = String(authContext?.role || authContext?.claims?.role || '').toLowerCase();
  if (role === 'admin') {
    return new Set(['*']);
  }

  const allowedCars = normalizeAllowedCarIds(authContext.allowed_car_ids || authContext.claims?.allowed_car_ids);
  if (allowedCars.length === 0) {
    return new Set(['car-44']);
  }
  return new Set(allowedCars);
}

function canAccessCar(authContext, carId) {
  const normalized = String(carId || '').trim();
  if (!normalized) return false;
  const allowedCars = getAllowedCarsFromAuthContext(authContext);
  return allowedCars.has('*') || allowedCars.has(normalized);
}

function resolveEvolutionActor(req = {}) {
  const auth = req.evolutionAuth || {};
  const claims = auth.claims || {};
  const user = auth.user || {};
  return {
    actor_user_id: String(user._id || user.id || claims.sub || '').trim() || null,
    actor_role: String(user.role || claims.role || '').trim() || null,
    actor_email: String(user.email || claims.email || '').trim().toLowerCase() || null,
  };
}

function resolveDeniedAuditAction(reason = '') {
  const normalized = String(reason || '').trim().toLowerCase();
  if (normalized === 'forbidden_car_id') return 'evolution.http.acl_denied';
  if (normalized === 'missing_car_id') return 'evolution.http.request_denied';
  if (
    normalized === 'missing_token'
    || normalized === 'authentication_failed'
    || normalized === 'invalid_token'
    || normalized === 'session_revoked'
    || normalized === 'token_revoked'
    || normalized === 'missing_session'
    || normalized === 'user_not_found'
    || normalized === 'persistence_unavailable'
  ) {
    return 'evolution.http.auth_denied';
  }
  return 'evolution.http.denied';
}

async function safeRecordEvolutionAudit(req, payload = {}) {
  try {
    await recordAuditEvent({
      category: 'evolution',
      source: 'http',
      request_id: req.requestId || null,
      method: req.method || null,
      path: req.originalUrl || req.path || null,
      ip: req.ip || req.headers?.['x-forwarded-for'] || null,
      user_agent: req.headers?.['user-agent'] || null,
      ...resolveEvolutionActor(req),
      ...payload,
    });
  } catch (_error) {
    // no-op: audit persistence must not block runtime API path
  }
}

function denyWithAuthError(req, res, status, reason, details = null) {
  // Fire-and-forget so denial response latency stays deterministic.
  safeRecordEvolutionAudit(req, {
    action: resolveDeniedAuditAction(reason),
    outcome: 'denied',
    reason,
    target_type: details?.car_ids ? 'car' : null,
    car_ids: Array.isArray(details?.car_ids) ? details.car_ids : [],
    metadata: details || undefined,
  });

  res.status(status).json({
    success: false,
    error: status === 401 ? 'Unauthorized' : 'Forbidden',
    reason,
    details: details || undefined,
    service: 'evolution',
    timestamp: new Date().toISOString(),
  });
}

async function requireEvolutionProductionAccess(req, res, next) {
  if (!HTTP_AUTH_REQUIRED) {
    req.evolutionAuth = {
      role: 'admin',
      allowed_car_ids: ['*'],
      claims: {
        sub: 'anonymous-open',
        role: 'admin',
      },
    };
    return next();
  }

  const token = parseBearerToken(req);
  if (!token) {
    return denyWithAuthError(req, res, 401, 'missing_token');
  }

  let verified;
  try {
    verified = await verifyAccessToken(token, {
      requireSession: HTTP_REQUIRE_SESSION,
      requirePersistedUser: HTTP_ENFORCE_PERSISTED_ACL,
      failOnPersistenceUnavailable: HTTP_ENFORCE_PERSISTED_ACL && HTTP_FAIL_ON_ACL_STORE_UNAVAILABLE,
    });
  } catch (error) {
    logger.warn(`Evolution production auth verification failed: ${error.message}`);
    return denyWithAuthError(req, res, 401, 'authentication_failed');
  }

  if (!verified.ok) {
    return denyWithAuthError(req, res, 401, verified.reason || 'invalid_token');
  }

  req.evolutionAuth = verified;
  return next();
}

function requireCarAuthorization(req, res, carIds, options = {}) {
  const normalizedCarIds = [...new Set(
    (Array.isArray(carIds) ? carIds : [carIds])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
  if (normalizedCarIds.length === 0) {
    if (options.allowEmpty === true) {
      return {
        ok: true,
        requested: [],
      };
    }
    denyWithAuthError(req, res, 400, 'missing_car_id');
    return {
      ok: false,
      requested: [],
    };
  }

  const unauthorized = normalizedCarIds.filter((carId) => !canAccessCar(req.evolutionAuth, carId));
  if (unauthorized.length > 0) {
    denyWithAuthError(req, res, 403, 'forbidden_car_id', { car_ids: unauthorized });
    return {
      ok: false,
      requested: normalizedCarIds,
    };
  }
  return {
    ok: true,
    requested: normalizedCarIds,
  };
}

async function listRecentTelemetryCars(maxCars = 8) {
  const boundedMax = parseBoundedInteger(maxCars, 8, 1, 25);
  if (isMongoReady()) {
    const recent = await TelemetryPoint.find({}, { car_id: 1, timestamp: 1 })
      .sort({ timestamp: -1 })
      .limit(boundedMax * 40)
      .lean();

    const ordered = [];
    const seen = new Set();
    recent.forEach((record) => {
      const carId = String(record?.car_id || '').trim();
      if (!carId || seen.has(carId)) return;
      seen.add(carId);
      ordered.push(carId);
    });
    return ordered.slice(0, boundedMax);
  }

  const entries = [...telemetryFallbackStore.entries()]
    .map(([carId, points]) => {
      const last = points[points.length - 1];
      const stamp = last ? new Date(last.timestamp).getTime() : 0;
      return {
        car_id: carId,
        last_ts: Number.isFinite(stamp) ? stamp : 0,
      };
    })
    .sort((a, b) => b.last_ts - a.last_ts);

  return entries.slice(0, boundedMax).map((entry) => entry.car_id);
}

async function buildFleetTelemetrySummary({ carIds = [], limitPerCar = 120, fallbackEnabled = true }) {
  let resolvedCars = [...carIds];
  if (resolvedCars.length === 0) {
    resolvedCars = await listRecentTelemetryCars(8);
  }
  if (resolvedCars.length === 0 && fallbackEnabled) {
    resolvedCars = ['car-44'];
  }

  const carSummaries = [];
  for (const carId of resolvedCars) {
    if (fallbackEnabled) {
      await ensureSyntheticTelemetryIfEmpty(carId, 12);
    }
    const points = await listRecentTelemetryPoints(carId, limitPerCar);
    const summary = summarizeTelemetry(points);
    const latest = points[points.length - 1] || null;
    carSummaries.push({
      car_id: carId,
      window_points: summary.count,
      latest_timestamp: latest?.timestamp || null,
      summary,
    });
  }

  const fleetAggregate = carSummaries.reduce((acc, car) => {
    const n = car.summary.count;
    acc.cars += 1;
    acc.totalPoints += n;
    acc.speedWeighted += car.summary.avg_speed_kph * n;
    acc.efficiencyWeighted += car.summary.avg_efficiency * n;
    acc.peakSpeed = Math.max(acc.peakSpeed, car.summary.peak_speed_kph);
    acc.anomalyCount += car.summary.anomaly_count;
    return acc;
  }, {
    cars: 0,
    totalPoints: 0,
    speedWeighted: 0,
    efficiencyWeighted: 0,
    peakSpeed: 0,
    anomalyCount: 0,
  });

  return {
    fleet_summary: {
      cars_monitored: fleetAggregate.cars,
      total_window_points: fleetAggregate.totalPoints,
      peak_speed_kph: toRoundedNumber(fleetAggregate.peakSpeed, 3),
      avg_speed_kph: toRoundedNumber(
        fleetAggregate.speedWeighted / Math.max(fleetAggregate.totalPoints, 1),
        3
      ),
      avg_efficiency: toRoundedNumber(
        fleetAggregate.efficiencyWeighted / Math.max(fleetAggregate.totalPoints, 1),
        4
      ),
      anomaly_count: fleetAggregate.anomalyCount,
    },
    cars: carSummaries,
  };
}

function createSyntheticTelemetryPoint(carId, idx = 0, baseTime = Date.now()) {
  const phaseA = Math.sin((idx + 1) * 0.41);
  const phaseB = Math.cos((idx + 1) * 0.27);
  const speed = clamp(292 + phaseA * 14 + phaseB * 9, 255, 340);
  const drag = clamp(1220 + phaseB * 55, 900, 1600);
  const downforce = clamp(3920 + phaseA * 210 + (speed - 280) * 3.5, 2600, 6200);
  const drsOpen = speed > 305 && Math.abs(phaseA) < 0.65;

  return {
    telemetry_id: `synthetic-${carId}-${idx + 1}`,
    car_id: carId,
    source: 'synthetic-fallback',
    timestamp: new Date(baseTime - (11 - idx) * 400).toISOString(),
    lap: 12,
    sector: ((idx % 3) + 1),
    speed_kph: toRoundedNumber(speed, 3),
    yaw_deg: toRoundedNumber(phaseB * 1.6, 4),
    downforce_n: toRoundedNumber(downforce, 3),
    drag_n: toRoundedNumber(drag, 3),
    battery_soc: toRoundedNumber(clamp(73 - idx * 0.45, 15, 100), 3),
    ers_deploy_kw: toRoundedNumber(clamp(190 + phaseA * 30, 0, 350), 3),
    drs_open: drsOpen,
    track_temp_c: toRoundedNumber(31 + phaseB * 2.2, 3),
    anomalies: [],
  };
}

async function ensureSyntheticTelemetryIfEmpty(carId, minimumPoints = 10) {
  const currentCount = await countTelemetryPoints(carId);
  if (currentCount > 0) {
    return;
  }

  const now = Date.now();
  const seedPoints = Array.from({ length: minimumPoints }).map((_, idx) => (
    createSyntheticTelemetryPoint(carId, idx, now)
  ));

  if (isMongoReady()) {
    try {
      await TelemetryPoint.insertMany(seedPoints, { ordered: false });
    } catch (error) {
      logger.warn(`Synthetic telemetry seed insert warning: ${error.message}`);
    }
    return;
  }

  const buffer = ensureFallbackBuffer(carId);
  buffer.push(...seedPoints);
}

function parseTelemetryPayload(body = {}) {
  const carId = String(body.car_id || body.carId || 'car-44').trim() || 'car-44';
  const timestamp = normalizeTimestamp(body.timestamp);

  return {
    telemetry_id: String(body.telemetry_id || body.telemetryId || randomUUID()),
    car_id: carId,
    source: String(body.source || 'api'),
    timestamp,
    lap: parseBoundedInteger(body.lap, 0, 0, 250),
    sector: parseBoundedInteger(body.sector, 1, 1, 3),
    speed_kph: toRoundedNumber(body.speed_kph, 3, toRoundedNumber(body.speed, 3, 280)),
    yaw_deg: toRoundedNumber(body.yaw_deg, 4, toRoundedNumber(body.yaw, 4, 0)),
    downforce_n: toRoundedNumber(body.downforce_n, 3, toRoundedNumber(body.downforce, 3, 3500)),
    drag_n: toRoundedNumber(body.drag_n, 3, toRoundedNumber(body.drag, 3, 1200)),
    battery_soc: toRoundedNumber(body.battery_soc, 3, toRoundedNumber(body.soc, 3, 70)),
    ers_deploy_kw: toRoundedNumber(body.ers_deploy_kw, 3, toRoundedNumber(body.ers_kw, 3, 200)),
    drs_open: Boolean(body.drs_open ?? body.drsOpen ?? false),
    track_temp_c: toRoundedNumber(body.track_temp_c, 3, toRoundedNumber(body.track_temp, 3, 30)),
  };
}

function chooseRecentSeed(candidates = [], idx = 0) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const at = idx % candidates.length;
  return candidates[at];
}

function buildSyntheticDiffusionCandidate(index, target, latentDim, seedId = 'synthetic-seed') {
  const phaseA = Math.sin((index + 1) * 1.27);
  const phaseB = Math.cos((index + 1) * 0.73);

  const cl = clamp(target.target_cl + phaseA * 0.21, 0.2, 5.5);
  const cd = clamp(target.target_cd + phaseB * 0.04, 0.03, 1.6);
  const cm = clamp(target.target_cm + phaseA * 0.02, -1.5, 1.5);
  const lOverD = cl / Math.max(cd, 1e-6);

  const targetError =
    Math.abs(cl - target.target_cl) / Math.max(Math.abs(target.target_cl), 1e-6)
    + Math.abs(cd - target.target_cd) / Math.max(Math.abs(target.target_cd), 1e-6);

  const noveltyScore = clamp(0.62 + Math.abs(phaseA) * 0.25, 0.1, 0.99);
  const manufacturabilityScore = clamp(0.91 - Math.abs(phaseB) * 0.22, 0.15, 0.99);
  const quality = clamp(1 - targetError * 0.58, 0.05, 0.99);

  return {
    id: `diffusion-${seedId}-${index + 1}`,
    seed_simulation_id: seedId,
    source: 'synthetic-fallback',
    quality_score: toRoundedNumber(quality, 4),
    novelty_score: toRoundedNumber(noveltyScore, 4),
    manufacturability_score: toRoundedNumber(manufacturabilityScore, 4),
    latent_vector_norm: toRoundedNumber(0.8 + Math.sqrt(latentDim / 16) * (0.7 + Math.abs(phaseB)), 4),
    parameters: {
      cl: toRoundedNumber(cl, 5),
      cd: toRoundedNumber(cd, 5),
      cm: toRoundedNumber(cm, 5),
      l_over_d: toRoundedNumber(lOverD, 5),
      span: toRoundedNumber(clamp(1.6 + phaseA * 0.25, 1.0, 2.8), 4),
      chord: toRoundedNumber(clamp(0.35 + phaseB * 0.07, 0.12, 1.2), 4),
      twist: toRoundedNumber(clamp(phaseA * 3.8, -8, 8), 4),
      sweep: toRoundedNumber(clamp(6 + phaseB * 4.2, -2, 24), 4),
      taper_ratio: toRoundedNumber(clamp(0.72 + phaseA * 0.11, 0.3, 1.1), 4),
      volume: toRoundedNumber(clamp(0.32 + Math.abs(phaseA) * 0.18, 0.12, 1.4), 4),
    },
  };
}

function remapCandidateToDiffusion(candidate, idx, target, latentDim, source = null) {
  const parameters = candidate?.parameters || candidate?.metrics || candidate?.aero || {};
  const cl = toFiniteNumber(parameters.cl ?? candidate?.cl, target.target_cl);
  const cd = toFiniteNumber(parameters.cd ?? candidate?.cd, target.target_cd);
  const cm = toFiniteNumber(parameters.cm ?? candidate?.cm, target.target_cm);
  const lOverD = cl / Math.max(cd, 1e-6);

  const targetError =
    Math.abs(cl - target.target_cl) / Math.max(Math.abs(target.target_cl), 1e-6)
    + Math.abs(cd - target.target_cd) / Math.max(Math.abs(target.target_cd), 1e-6);

  return {
    id: String(candidate.id || candidate.candidate_id || `diffusion-candidate-${idx + 1}`),
    seed_simulation_id: String(candidate.seed_simulation_id || candidate.simulation_id || 'simulation-seed'),
    source: source || candidate.source || 'diffusion-service',
    quality_score: toRoundedNumber(
      candidate.quality_score ?? candidate.quality ?? candidate.score,
      4,
      clamp(1 - targetError * 0.52, 0.05, 0.99)
    ),
    novelty_score: toRoundedNumber(
      candidate.novelty_score ?? candidate.novelty,
      4,
      0.62 + (idx % 17) * 0.021
    ),
    manufacturability_score: toRoundedNumber(
      candidate.manufacturability_score ?? candidate.manufacturability,
      4,
      0.9 - (idx % 9) * 0.028
    ),
    latent_vector_norm: toRoundedNumber(
      candidate.latent_vector_norm ?? candidate.latent_norm,
      4,
      0.72 + Math.sqrt(latentDim / 16) * (1 + (idx % 5) * 0.11)
    ),
    parameters: {
      cl: toRoundedNumber(cl, 5),
      cd: toRoundedNumber(cd, 5),
      cm: toRoundedNumber(cm, 5),
      l_over_d: toRoundedNumber(lOverD, 5),
      span: toRoundedNumber(parameters.span, 4, 1.5),
      chord: toRoundedNumber(parameters.chord, 4, 0.3),
      twist: toRoundedNumber(parameters.twist, 4, 0),
      sweep: toRoundedNumber(parameters.sweep, 4, 6),
      taper_ratio: toRoundedNumber(parameters.taper_ratio, 4, 0.75),
      volume: toRoundedNumber(parameters.volume, 4, 0.36),
    },
  };
}

async function fetchSimulationCandidates(req, payload) {
  const baseUrl = resolveBackendBaseUrl(req);
  const endpoint = `${baseUrl}/api/simulation/candidates/generate`;
  try {
    const response = await axios.post(endpoint, payload, {
      timeout: 7000,
      headers: req.requestId ? { 'x-request-id': req.requestId } : undefined,
    });
    const data = response?.data?.data || {};
    return {
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
      seed_count: toFiniteNumber(data.seed_count, 0),
      num_generated: toFiniteNumber(data.num_generated, 0),
      source: 'simulation-service',
    };
  } catch (error) {
    logger.warn(`Evolution simulation seed fetch failed: ${error.message}`);
    return {
      candidates: [],
      seed_count: 0,
      num_generated: 0,
      source: 'fallback',
      error: error.message,
    };
  }
}

async function fetchDiffusionCandidatesFromService(req, config) {
  const {
    requested_count,
    target,
    latent_dim,
    diffusion_steps,
    guidance_scale,
    seed_limit,
  } = config;

  try {
    const response = await diffusionClient.post(
      DIFFUSION_SERVICE_ENDPOINT,
      {
        num_candidates: requested_count,
        target_cl: target.target_cl,
        target_cd: target.target_cd,
        target_cm: target.target_cm,
        latent_dim,
        diffusion_steps,
        guidance_scale,
        seed_limit,
      },
      {
        headers: req.requestId ? { 'x-request-id': req.requestId } : undefined,
      }
    );

    const payload = response?.data?.data || response?.data || {};
    const rawCandidates = Array.isArray(payload.candidates)
      ? payload.candidates
      : (Array.isArray(payload.generated_candidates) ? payload.generated_candidates : []);
    const normalized = rawCandidates.map((candidate, idx) => (
      remapCandidateToDiffusion(candidate, idx, target, latent_dim, 'diffusion-service')
    ));

    return {
      model: String(payload.model || payload.model_name || 'aero-diffusion-service-v1'),
      candidates: normalized,
      seed_count: toFiniteNumber(payload.seed_count, 0),
      source: 'diffusion-service',
      fallback_used: false,
    };
  } catch (error) {
    logger.warn(`Diffusion model service unavailable: ${error.message}`);
    return {
      model: 'aero-diffusion-service-v1',
      candidates: [],
      seed_count: 0,
      source: 'fallback',
      fallback_used: true,
      error: error.message,
    };
  }
}

async function fetchParetoSummary(req) {
  const nowMs = Date.now();
  if (paretoCache.value && paretoCache.expires_at_ms > nowMs) {
    return {
      ...paretoCache.value,
      cached: true,
    };
  }

  const baseUrl = resolveBackendBaseUrl(req);
  const endpoint = `${baseUrl}/api/simulation/pareto`;

  try {
    const response = await axios.get(endpoint, {
      timeout: 7000,
      params: {
        limit_runs: 25,
        max_points: 120,
      },
      headers: req.requestId ? { 'x-request-id': req.requestId } : undefined,
    });
    const data = response?.data?.data || {};
    const points = Array.isArray(data.points) ? data.points : [];
    const bestPoint = points.reduce((best, point) => {
      const candidate = toFiniteNumber(point?.objective?.efficiency, -Infinity);
      const bestScore = toFiniteNumber(best?.objective?.efficiency, -Infinity);
      return candidate > bestScore ? point : best;
    }, null);

    const value = {
      points,
      best_point: bestPoint,
      source: 'simulation-pareto',
    };

    paretoCache.value = value;
    paretoCache.expires_at_ms = nowMs + 5000;
    return value;
  } catch (error) {
    logger.warn(`Evolution digital twin pareto fetch failed: ${error.message}`);
    return {
      points: [],
      best_point: null,
      source: 'fallback',
      error: error.message,
    };
  }
}

async function buildDigitalTwinPayload(req, carId, telemetryPoints = null) {
  let points = telemetryPoints;
  if (!Array.isArray(points) || points.length === 0) {
    await ensureSyntheticTelemetryIfEmpty(carId, 10);
    points = await listRecentTelemetryPoints(carId, 80);
  }

  const latest = points[points.length - 1] || createSyntheticTelemetryPoint(carId, 0);
  const telemetrySummary = summarizeTelemetry(points);
  const pareto = await fetchParetoSummary(req);

  const aeroEfficiency = toFiniteNumber(latest.downforce_n, 0) / Math.max(toFiniteNumber(latest.drag_n, 0), 1e-6);
  const stabilityIndex = clamp(
    0.84
    - Math.abs(toFiniteNumber(latest.yaw_deg, 0)) * 0.08
    + (latest.drs_open ? -0.03 : 0.02),
    0.15,
    0.99
  );

  const paretoTarget = pareto.best_point?.aerodynamic || null;
  const targetCl = toFiniteNumber(paretoTarget?.cl, 2.8);
  const targetCd = toFiniteNumber(paretoTarget?.cd, 0.4);
  const targetCm = toFiniteNumber(paretoTarget?.cm, -0.1);

  const recommendedDrs = latest.speed_kph > 300 && Math.abs(latest.yaw_deg) < 1.2;
  const recommendedFlap = clamp(8.2 - (latest.speed_kph - 280) * 0.015 + Math.abs(latest.yaw_deg) * 0.5, 2, 15);

  return {
    twin_id: `twin-${carId}`,
    car_id: carId,
    generated_at: new Date().toISOString(),
    state: {
      speed_kph: toRoundedNumber(latest.speed_kph, 3),
      yaw_deg: toRoundedNumber(latest.yaw_deg, 4),
      downforce_n: toRoundedNumber(latest.downforce_n, 3),
      drag_n: toRoundedNumber(latest.drag_n, 3),
      battery_soc: toRoundedNumber(latest.battery_soc, 3),
      drs_open: Boolean(latest.drs_open),
      aero_efficiency: toRoundedNumber(aeroEfficiency, 5),
      stability_index: toRoundedNumber(stabilityIndex, 5),
    },
    telemetry_window: telemetrySummary,
    optimization_context: {
      pareto_points: pareto.points.length,
      target_cl: toRoundedNumber(targetCl, 4),
      target_cd: toRoundedNumber(targetCd, 4),
      target_cm: toRoundedNumber(targetCm, 4),
      source: pareto.source,
    },
    recommendations: {
      drs_open: recommendedDrs,
      flap_angle_deg: toRoundedNumber(recommendedFlap, 3),
      expected_lap_delta_ms: toRoundedNumber(-(aeroEfficiency - telemetrySummary.avg_efficiency) * 3.2, 3),
    },
  };
}

/**
 * POST /api/evolution/generative/diffusion/generate
 * Phase 3 contract: diffusion-like candidate generation for aero geometry.
 */
router.post('/generative/diffusion/generate', async (req, res) => {
  const requestedCount = parseBoundedInteger(req.body?.num_candidates, 24, 1, 250);
  const latentDim = parseBoundedInteger(req.body?.latent_dim, 32, 8, 256);
  const diffusionSteps = parseBoundedInteger(req.body?.diffusion_steps, 50, 10, 200);
  const guidanceScale = toRoundedNumber(req.body?.guidance_scale, 3, 7.5);
  const seedLimit = parseBoundedInteger(req.body?.seed_limit, 25, 1, 120);

  const target = {
    target_cl: toRoundedNumber(req.body?.target_cl, 4, 2.8),
    target_cd: toRoundedNumber(req.body?.target_cd, 4, 0.4),
    target_cm: toRoundedNumber(req.body?.target_cm, 4, -0.1),
  };

  const diffusionResult = await fetchDiffusionCandidatesFromService(req, {
    requested_count: requestedCount,
    target,
    latent_dim: latentDim,
    diffusion_steps: diffusionSteps,
    guidance_scale: guidanceScale,
    seed_limit: seedLimit,
  });

  let candidates = [...diffusionResult.candidates];
  let usedFallback = diffusionResult.fallback_used;
  let seedCount = diffusionResult.seed_count;
  const sourceLabels = [diffusionResult.source];

  if (candidates.length < requestedCount) {
    const simulationSeed = await fetchSimulationCandidates(req, {
      num_candidates: requestedCount,
      target_cl: target.target_cl,
      target_cd: target.target_cd,
      target_cm: target.target_cm,
      seed_limit: seedLimit,
    });

    seedCount += simulationSeed.seed_count;
    if (simulationSeed.candidates.length > 0) {
      const simulationCandidates = simulationSeed.candidates.map((candidate, idx) => (
        remapCandidateToDiffusion(candidate, idx, target, latentDim, 'simulation-candidate')
      ));
      candidates = [...candidates, ...simulationCandidates];
      sourceLabels.push(simulationSeed.source);
      usedFallback = true;
    }
  }

  if (candidates.length < requestedCount) {
    const needed = requestedCount - candidates.length;
    const synthetic = Array.from({ length: needed }).map((_, idx) => {
      const seed = chooseRecentSeed(candidates, idx);
      return buildSyntheticDiffusionCandidate(
        idx + candidates.length,
        target,
        latentDim,
        seed?.seed_simulation_id || 'hybrid-seed'
      );
    });
    candidates = [...candidates, ...synthetic];
    sourceLabels.push('synthetic-fallback');
    usedFallback = true;
  }

  candidates = candidates.slice(0, requestedCount);
  const avgQuality = candidates.reduce((sum, candidate) => sum + toFiniteNumber(candidate.quality_score, 0), 0) / Math.max(candidates.length, 1);
  const avgNovelty = candidates.reduce((sum, candidate) => sum + toFiniteNumber(candidate.novelty_score, 0), 0) / Math.max(candidates.length, 1);
  const targetHitRate = candidates.filter((candidate) => {
    const cl = toFiniteNumber(candidate.parameters?.cl, 0);
    const cd = toFiniteNumber(candidate.parameters?.cd, 0);
    return cl >= target.target_cl * 0.95 && cd <= target.target_cd * 1.05;
  }).length / Math.max(candidates.length, 1);

  res.json({
    success: true,
    data: {
      model: diffusionResult.model,
      requested_candidates: requestedCount,
      diffusion_steps: diffusionSteps,
      guidance_scale: guidanceScale,
      latent_dim: latentDim,
      target,
      candidates,
      stats: {
        num_generated: candidates.length,
        seed_count: seedCount,
        avg_quality_score: toRoundedNumber(avgQuality, 4),
        avg_novelty_score: toRoundedNumber(avgNovelty, 4),
        target_hit_rate: toRoundedNumber(targetHitRate, 4),
        fallback_used: usedFallback,
        seed_source: sourceLabels.filter(Boolean).join('+'),
      },
    },
    service: 'evolution',
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/evolution/generative/rl/train
 * Phase 3 contract: submit SB3 RL policy training job and persist lifecycle metadata.
 */
router.post('/generative/rl/train', async (req, res, next) => {
  try {
    const trackId = normalizeTrackId(req.body?.track_id || req.body?.track || 'global');
    const policyName = String(req.body?.policy_name || `ppo-active-control-${trackId}`).trim() || 'ppo-active-control-v1';
    const autoDeploy = parseBoolean(req.body?.auto_deploy, true);
    const trainingConfig = normalizeRlTrainingConfig(req.body?.config || req.body || {});

    let run;
    let mode = 'service';
    try {
      run = await submitRlTrainingJob({
        req,
        trackId,
        policyName,
        trainingConfig,
        autoDeploy,
      });
    } catch (serviceError) {
      if (!RL_TRAINING_ALLOW_SYNTHETIC_FALLBACK) {
        res.status(503).json({
          success: false,
          error: 'rl_training_service_unavailable',
          message: 'RL training service is unavailable and synthetic fallback is disabled.',
          details: {
            service_url: RL_TRAINING_SERVICE_URL,
            submit_endpoint: RL_TRAINING_SUBMIT_ENDPOINT,
            reason: serviceError.reason || serviceError.message,
            message: serviceError.message,
            status: serviceError?.details?.status ?? null,
            code: serviceError?.details?.code ?? null,
            submit_attempts: serviceError?.details?.submit_attempts ?? null,
            circuit: serviceError?.details?.circuit || buildRlTrainerCircuitState(),
          },
          service: 'evolution',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      logger.warn(`RL training service unavailable, using synthetic fallback: ${serviceError.message}`);
      run = buildSyntheticRlRun({
        trackId,
        config: trainingConfig,
        policyName,
        autoDeploy,
      });
      run = withRlDeploymentGate(run);
      mode = 'synthetic-fallback';
    }

    const persisted = await persistRlPolicyRun(withRlDeploymentGate(run));
    const deploymentGate = persisted?.config?.deployment_gate || evaluateRlDeploymentEligibility(persisted);
    if (autoDeploy && persisted.status === 'completed') {
      if (deploymentGate.eligible) {
        await setActiveRlPolicyRun(persisted.run_id, trackId);
      } else {
        logger.warn(`RL policy deployment blocked by guardrails for run ${persisted.run_id}`);
      }
    }
    const finalRun = await getRlPolicyRunById(persisted.run_id) || persisted;
    const finalDeploymentGate = finalRun?.config?.deployment_gate || deploymentGate;

    res.status(202).json({
      success: true,
      data: {
        run: finalRun,
        mode,
        deployment: {
          auto_deploy: autoDeploy,
          active: Boolean(finalRun?.deployment?.active),
          active_track: trackId,
          guardrails: finalDeploymentGate,
        },
        run_state_machine: {
          terminal_states: ['completed', 'failed'],
          current_state: String(finalRun?.status || 'queued'),
          sync_interval_ms: RL_TRAINING_SYNC_INTERVAL_MS,
          retry_policy: {
            submit_max_retries: RL_TRAINING_SUBMIT_MAX_RETRIES,
            sync_max_retries: RL_TRAINING_SYNC_MAX_RETRIES,
            backoff_base_ms: RL_TRAINING_RETRY_BACKOFF_MS,
          },
          service_circuit: buildRlTrainerCircuitState(),
        },
      },
      service: 'evolution',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/evolution/generative/rl/train/:runId
 * Phase 3 contract: fetch specific RL training run metadata.
 */
router.get('/generative/rl/train/:runId', async (req, res, next) => {
  try {
    const runId = String(req.params.runId || '').trim();
    const run = await getRlPolicyRunById(runId);
    if (!run) {
      res.status(404).json({
        success: false,
        error: 'rl_policy_run_not_found',
        message: `No RL policy run found for run_id=${runId}`,
        service: 'evolution',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const sync = parseBoolean(req.query.sync, true);
    const forceSync = parseBoolean(req.query.force_sync, false);
    const resolvedRun = sync
      ? (await syncRlPolicyRunState(run, { force: forceSync })) || run
      : run;

    res.json({
      success: true,
      data: {
        ...resolvedRun,
        run_state_machine: {
          terminal_states: ['completed', 'failed'],
          current_state: String(resolvedRun?.status || 'queued'),
          sync_interval_ms: RL_TRAINING_SYNC_INTERVAL_MS,
          sync_enabled: sync,
          retry_policy: {
            submit_max_retries: RL_TRAINING_SUBMIT_MAX_RETRIES,
            sync_max_retries: RL_TRAINING_SYNC_MAX_RETRIES,
            backoff_base_ms: RL_TRAINING_RETRY_BACKOFF_MS,
          },
          service_circuit: buildRlTrainerCircuitState(),
        },
      },
      service: 'evolution',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/evolution/generative/rl/policies
 * Phase 3 contract: list recent RL policy runs by track/status.
 */
router.get('/generative/rl/policies', async (req, res, next) => {
  try {
    const trackId = req.query.track_id ? normalizeTrackId(req.query.track_id) : null;
    const status = req.query.status ? String(req.query.status).trim().toLowerCase() : 'all';
    const limit = parseBoundedInteger(req.query.limit, 12, 1, 100);
    const activeOnly = parseBoolean(req.query.active_only, false);
    const sync = parseBoolean(req.query.sync, true);

    let policies = await listRlPolicyRuns({
      trackId,
      status,
      limit,
    });
    if (sync && policies.length > 0) {
      policies = await Promise.all(policies.map((policy) => syncRlPolicyRunState(policy)));
    }
    if (activeOnly) {
      policies = policies.filter((policy) => policy.deployment?.active);
    }

    res.json({
      success: true,
      data: {
        track_id: trackId || null,
        status: status || null,
        limit,
        count: policies.length,
        policies,
        run_state_machine: {
          terminal_states: ['completed', 'failed'],
          sync_interval_ms: RL_TRAINING_SYNC_INTERVAL_MS,
          sync_enabled: sync,
          retry_policy: {
            submit_max_retries: RL_TRAINING_SUBMIT_MAX_RETRIES,
            sync_max_retries: RL_TRAINING_SYNC_MAX_RETRIES,
            backoff_base_ms: RL_TRAINING_RETRY_BACKOFF_MS,
          },
          service_circuit: buildRlTrainerCircuitState(),
        },
      },
      service: 'evolution',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/evolution/generative/rl/recommend
 * Phase 3 contract: active-control recommendation (DRS/flap) from current state.
 */
router.post('/generative/rl/recommend', async (req, res, next) => {
  try {
    const state = req.body?.state || req.body || {};
    const trackId = normalizeTrackId(state.track_id || req.body?.track_id || 'global');
    const speedKph = toFiniteNumber(state.speed_kph ?? state.speed, 290);
    const yawDeg = toFiniteNumber(state.yaw_deg ?? state.yaw, 0.4);
    const batterySoc = clamp(toFiniteNumber(state.battery_soc ?? state.soc, 68), 0, 100);
    const tireTemp = toFiniteNumber(state.tire_temp_c ?? state.tire_temp, 92);
    const drsAvailable = Boolean(state.drs_available ?? true);
    const sector = parseBoundedInteger(state.sector, 1, 1, 3);

    const resolvedPolicy = await resolveRlPolicyForTrack(trackId);
    const actionProfile = normalizeActionProfile(trackId, resolvedPolicy.policy?.action_profile || {});

    const straightLine = sector === 1 || sector === 3;
    const allowDrs = drsAvailable
      && straightLine
      && Math.abs(yawDeg) < actionProfile.drs_max_yaw_deg
      && speedKph > actionProfile.drs_speed_threshold;
    const baseFlap = actionProfile.flap_base_deg
      - (speedKph - 250) * actionProfile.flap_speed_coeff
      + (Math.abs(yawDeg) * actionProfile.flap_yaw_coeff);
    const tireCompensation = tireTemp > 105
      ? actionProfile.flap_tire_hot_comp_deg
      : (tireTemp < 85 ? actionProfile.flap_tire_cold_comp_deg : 0);
    const energyCompensation = batterySoc < 35
      ? actionProfile.flap_low_soc_comp_deg
      : actionProfile.flap_high_soc_comp_deg;
    const flapAngle = clamp(baseFlap + tireCompensation + energyCompensation, 2.0, 14.8);

    const expectedDownforceDelta = allowDrs ? -320 + flapAngle * 19 : 180 + flapAngle * 26;
    const expectedDragDelta = allowDrs ? -115 + flapAngle * 3.2 : 32 + flapAngle * 4.3;
    const expectedLapDeltaMs = -(
      (allowDrs ? 14 : 6)
      + clamp(speedKph - 280, -40, 40) * 0.06
      - Math.abs(yawDeg) * 1.4
      - Math.max(0, 95 - tireTemp) * 0.03
    );

    const confidence = clamp(
      0.68
      + (allowDrs ? 0.08 : 0)
      - Math.abs(yawDeg) * 0.05
      - Math.max(0, 105 - tireTemp) * 0.002
      + (resolvedPolicy.policy?.deployment?.active ? 0.04 : 0)
      + (resolvedPolicy.source.includes('trained') ? 0.03 : 0),
      0.32,
      0.98
    );

    res.json({
      success: true,
      data: {
        policy: String(resolvedPolicy.policy?.policy_name || 'ppo-active-control-proxy'),
        policy_metadata: {
          training_run_id: resolvedPolicy.policy?.run_id || null,
          track_id: trackId,
          source: resolvedPolicy.source,
          active: Boolean(resolvedPolicy.policy?.deployment?.active),
          status: String(resolvedPolicy.policy?.status || 'completed'),
        },
        state: {
          speed_kph: toRoundedNumber(speedKph, 3),
          yaw_deg: toRoundedNumber(yawDeg, 4),
          battery_soc: toRoundedNumber(batterySoc, 3),
          tire_temp_c: toRoundedNumber(tireTemp, 3),
          drs_available: drsAvailable,
          sector,
          track_id: trackId,
        },
        action: {
          drs_open: allowDrs,
          flap_angle_deg: toRoundedNumber(flapAngle, 3),
          ride_height_adjust_mm: toRoundedNumber(
            clamp(
              actionProfile.ride_base_mm - Math.abs(yawDeg) * actionProfile.ride_yaw_coeff,
              -0.6,
              0.8
            ),
            3
          ),
          ers_deploy_kw: toRoundedNumber(
            clamp(
              actionProfile.ers_base_kw
                + (allowDrs ? actionProfile.ers_drs_bonus_kw : actionProfile.ers_no_drs_penalty_kw)
                + batterySoc * actionProfile.ers_soc_coeff,
              80,
              350
            ),
            3
          ),
        },
        expected_delta: {
          downforce_n: toRoundedNumber(expectedDownforceDelta, 3),
          drag_n: toRoundedNumber(expectedDragDelta, 3),
          lap_time_ms: toRoundedNumber(expectedLapDeltaMs, 3),
        },
        confidence: toRoundedNumber(confidence, 4),
        reasoning: [
          allowDrs ? 'DRS enabled on straight sector with low yaw' : 'DRS kept closed for stability',
          tireTemp > 105 ? 'High tire temperature: reduce flap load' : 'Tire temperature within nominal range',
          batterySoc < 35 ? 'Low battery SOC: conservative ERS deployment' : 'Battery SOC supports aggressive deployment',
          `Policy source: ${resolvedPolicy.source}`,
        ],
      },
      service: 'evolution',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Production routes share persisted auth/session + ACL policy.
 */
router.use('/production', requireEvolutionProductionAccess);

/**
 * POST /api/evolution/production/telemetry/ingest
 * Phase 4 contract: ingest runtime telemetry points for digital twin feedback loop.
 */
router.post('/production/telemetry/ingest', async (req, res, next) => {
  try {
    const telemetryPoint = parseTelemetryPayload(req.body);
    const access = requireCarAuthorization(req, res, telemetryPoint.car_id);
    if (!access.ok) {
      return;
    }

    const previous = await getLatestTelemetryPoint(telemetryPoint.car_id);
    telemetryPoint.anomalies = collectAnomalies(telemetryPoint, previous);

    const persistedPoint = await persistTelemetryPoint(telemetryPoint);
    await trimTelemetryPoints(telemetryPoint.car_id);

    const queueDepth = await countTelemetryPoints(telemetryPoint.car_id);
    const recentPoints = await listRecentTelemetryPoints(telemetryPoint.car_id, 80);
    const summary = summarizeTelemetry(recentPoints);
    const twinPayload = await buildDigitalTwinPayload(req, telemetryPoint.car_id, recentPoints);

    publishEvolutionEvent('telemetry_update', {
      car_id: telemetryPoint.car_id,
      point: persistedPoint,
      summary,
      total_points: queueDepth,
    }, {
      car_id: telemetryPoint.car_id,
    });

    publishEvolutionEvent('digital_twin_update', {
      car_id: telemetryPoint.car_id,
      twin: twinPayload,
    }, {
      car_id: telemetryPoint.car_id,
    });

    res.status(202).json({
      success: true,
      data: {
        accepted: true,
        telemetry_id: persistedPoint.telemetry_id,
        car_id: persistedPoint.car_id,
        queue_depth: queueDepth,
        anomalies: persistedPoint.anomalies,
        point: persistedPoint,
      },
      service: 'evolution',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/evolution/production/telemetry/recent
 * Phase 4 contract: recent telemetry window with summary metrics.
 */
router.get('/production/telemetry/recent', async (req, res, next) => {
  try {
    const carId = String(req.query.car_id || 'car-44').trim() || 'car-44';
    const access = requireCarAuthorization(req, res, carId);
    if (!access.ok) {
      return;
    }

    const limit = parseBoundedInteger(req.query.limit, TELEMETRY_DEFAULT_LIMIT, 1, TELEMETRY_MAX_LIMIT);
    const fallbackEnabled = String(req.query.fallback || 'true').toLowerCase() !== 'false';

    if (fallbackEnabled) {
      await ensureSyntheticTelemetryIfEmpty(carId, 12);
    }

    const recentPoints = await listRecentTelemetryPoints(carId, limit);
    const totalPoints = await countTelemetryPoints(carId);
    const summary = summarizeTelemetry(recentPoints);

    res.json({
      success: true,
      data: {
        car_id: carId,
        limit,
        total_points: totalPoints,
        points: recentPoints,
        summary,
      },
      service: 'evolution',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/evolution/production/telemetry/summary
 * Phase 4 contract: fleet-level telemetry summary for operations dashboards.
 */
router.get('/production/telemetry/summary', async (req, res, next) => {
  try {
    let carIds = parseCarIdsQuery(req.query.car_ids || req.query.car_id);
    const allowedCars = getAllowedCarsFromAuthContext(req.evolutionAuth);
    if (carIds.length > 0) {
      const access = requireCarAuthorization(req, res, carIds);
      if (!access.ok) {
        return;
      }
      carIds = access.requested;
    } else if (!allowedCars.has('*')) {
      carIds = [...allowedCars];
    }

    const limitPerCar = parseBoundedInteger(req.query.limit_per_car, 120, 10, 500);
    const fallbackEnabled = String(req.query.fallback || 'true').toLowerCase() !== 'false';
    const summary = await buildFleetTelemetrySummary({
      carIds,
      limitPerCar,
      fallbackEnabled,
    });

    res.json({
      success: true,
      data: {
        ...summary,
        limit_per_car: limitPerCar,
      },
      service: 'evolution',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/evolution/production/stream/status
 * Phase 4 contract: websocket stream status for runtime observability.
 */
router.get('/production/stream/status', (req, res) => {
  const stream = getEvolutionStreamStatus();
  res.json({
    success: true,
    data: {
      ...stream,
      auth_policy: {
        http_auth_required: HTTP_AUTH_REQUIRED,
        http_require_session: HTTP_REQUIRE_SESSION,
        http_enforce_persisted_acl: HTTP_ENFORCE_PERSISTED_ACL,
        http_fail_on_acl_store_unavailable: HTTP_FAIL_ON_ACL_STORE_UNAVAILABLE,
      },
      persistence: {
        mode: isMongoReady() ? 'mongo' : 'in-memory-fallback',
        mongo_ready: isMongoReady(),
      },
    },
    service: 'evolution',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/evolution/production/digital-twin/state
 * Phase 4 contract: fuse telemetry and simulation pareto context into current twin state.
 */
router.get('/production/digital-twin/state', async (req, res, next) => {
  try {
    const carId = String(req.query.car_id || 'car-44').trim() || 'car-44';
    const access = requireCarAuthorization(req, res, carId);
    if (!access.ok) {
      return;
    }

    const payload = await buildDigitalTwinPayload(req, carId);

    res.json({
      success: true,
      data: payload,
      service: 'evolution',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
