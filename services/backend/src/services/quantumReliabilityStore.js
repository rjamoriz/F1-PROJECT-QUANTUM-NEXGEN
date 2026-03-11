const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const QuantumProviderSample = require('../models/QuantumProviderSample');

const DEFAULT_WINDOW_MS = Number.isFinite(Number(process.env.QUANTUM_RELIABILITY_WINDOW_MS))
  ? Math.max(60_000, Number(process.env.QUANTUM_RELIABILITY_WINDOW_MS))
  : 3_600_000;
const DEFAULT_MAX_SAMPLES = Number.isFinite(Number(process.env.QUANTUM_RELIABILITY_MAX_SAMPLES))
  ? clamp(Math.round(Number(process.env.QUANTUM_RELIABILITY_MAX_SAMPLES)), 200, 25_000)
  : 6000;
const MEMORY_MAX_SAMPLES = Number.isFinite(Number(process.env.QUANTUM_RELIABILITY_MEMORY_MAX_SAMPLES))
  ? clamp(Math.round(Number(process.env.QUANTUM_RELIABILITY_MEMORY_MAX_SAMPLES)), 200, 50_000)
  : DEFAULT_MAX_SAMPLES;
const RETENTION_MS = Number.isFinite(Number(process.env.QUANTUM_RELIABILITY_RETENTION_MS))
  ? clamp(Math.round(Number(process.env.QUANTUM_RELIABILITY_RETENTION_MS)), 60_000, 30 * 24 * 60 * 60 * 1000)
  : 7 * 24 * 60 * 60 * 1000;

const memorySamples = [];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function nowTs() {
  return Date.now();
}

function toSafeNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toErrorRatePercent(value, fallback = null) {
  const numeric = toSafeNumber(value, NaN);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  if (numeric <= 1) {
    return Number((numeric * 100).toFixed(6));
  }
  if (numeric <= 100) {
    return Number(numeric.toFixed(6));
  }
  return fallback;
}

function normalizeString(value, fallback = null) {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeSource(value, fallback = null) {
  const source = normalizeString(value, fallback);
  return source ? source.toLowerCase() : fallback;
}

function normalizeSample(input = {}) {
  const sampleTs = Number.isFinite(Number(input.ts))
    ? new Date(Number(input.ts))
    : (input.ts instanceof Date ? new Date(input.ts.getTime()) : new Date());
  const safeTs = Number.isNaN(sampleTs.getTime()) ? new Date() : sampleTs;

  return {
    sample_id: normalizeString(input.sample_id, randomUUID()),
    ts: safeTs,
    provider: normalizeString(input.provider, 'unknown').toLowerCase(),
    operation: normalizeString(input.operation, 'unknown').toLowerCase(),
    success: input.success !== false,
    fallback_used: Boolean(input.fallback_used),
    upstream_error: Boolean(input.upstream_error),
    latency_ms: toSafeNumber(input.latency_ms, null),
    queue_length: toSafeNumber(input.queue_length, null),
    error_rate_percent: toErrorRatePercent(input.error_rate_percent ?? input.error_rate, null),
    backend: normalizeString(input.backend, null),
    source: normalizeSource(input.source, 'backend-route'),
    created_at: new Date(),
  };
}

function serializeSample(sample = {}) {
  return {
    sample_id: normalizeString(sample.sample_id, randomUUID()),
    ts: sample.ts instanceof Date ? sample.ts.toISOString() : new Date(sample.ts || nowTs()).toISOString(),
    provider: normalizeString(sample.provider, 'unknown'),
    operation: normalizeString(sample.operation, 'unknown'),
    success: sample.success !== false,
    fallback_used: Boolean(sample.fallback_used),
    upstream_error: Boolean(sample.upstream_error),
    latency_ms: toSafeNumber(sample.latency_ms, null),
    queue_length: toSafeNumber(sample.queue_length, null),
    error_rate_percent: toSafeNumber(sample.error_rate_percent, null),
    backend: normalizeString(sample.backend, null),
    source: normalizeSource(sample.source, 'backend-route'),
  };
}

function toDate(value, fallback = null) {
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed;
}

function isMongoQuantumReliabilityReady() {
  return mongoose?.connection?.readyState === 1 && QuantumProviderSample?.db?.readyState === 1;
}

function pruneMemorySamplesIfNeeded() {
  const oldestAllowedTs = nowTs() - RETENTION_MS;
  while (memorySamples.length > 0) {
    const head = memorySamples[0];
    const headTs = toDate(head?.ts, null);
    if (!headTs || headTs.getTime() < oldestAllowedTs) {
      memorySamples.shift();
    } else {
      break;
    }
  }

  while (memorySamples.length > MEMORY_MAX_SAMPLES) {
    memorySamples.shift();
  }
}

function filterMemorySamples(provider = null, minTs = new Date(nowTs() - DEFAULT_WINDOW_MS), source = null) {
  const providerKey = normalizeString(provider, null)?.toLowerCase() || null;
  const sourceKey = normalizeSource(source, null);
  const minTimestamp = toDate(minTs, new Date(nowTs() - DEFAULT_WINDOW_MS));

  return memorySamples.filter((sample) => {
    const sampleTs = toDate(sample.ts, null);
    if (!sampleTs || sampleTs.getTime() < minTimestamp.getTime()) return false;
    if (providerKey && String(sample.provider || '').toLowerCase() !== providerKey) return false;
    if (sourceKey && normalizeSource(sample.source, null) !== sourceKey) return false;
    return true;
  });
}

function dedupeSamples(samples = []) {
  const byId = new Map();
  samples.forEach((sample) => {
    const serialized = serializeSample(sample);
    byId.set(serialized.sample_id, serialized);
  });
  return [...byId.values()].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

async function recordQuantumProviderSample(input = {}) {
  const normalized = normalizeSample(input);
  memorySamples.push(normalized);
  pruneMemorySamplesIfNeeded();

  if (isMongoQuantumReliabilityReady()) {
    try {
      await QuantumProviderSample.create(normalized);
    } catch (error) {
      logger.warn(`Quantum reliability sample persistence failed: ${error.message}`);
    }
  }

  return serializeSample(normalized);
}

async function listQuantumProviderSamples(options = {}) {
  const provider = normalizeString(options.provider, null);
  const source = normalizeSource(options.source, null);
  const windowMs = clamp(
    Math.round(toSafeNumber(options.windowMs, DEFAULT_WINDOW_MS)),
    60_000,
    30 * 24 * 60 * 60 * 1000
  );
  const limit = clamp(
    Math.round(toSafeNumber(options.limit, DEFAULT_MAX_SAMPLES)),
    1,
    50_000
  );
  const minTs = new Date(nowTs() - windowMs);
  const memorySlice = filterMemorySamples(provider, minTs, source);
  let persistedSlice = [];

  if (isMongoQuantumReliabilityReady()) {
    const query = { ts: { $gte: minTs } };
    if (provider) {
      query.provider = provider.toLowerCase();
    }
    if (source) {
      query.source = source;
    }
    persistedSlice = await QuantumProviderSample.find(query)
      .sort({ ts: 1 })
      .limit(limit)
      .lean();
  }

  const merged = dedupeSamples([...persistedSlice, ...memorySlice]);
  if (merged.length > limit) {
    return merged.slice(-limit);
  }
  return merged;
}

async function getQuantumReliabilityStoreStatus(options = {}) {
  const provider = normalizeString(options.provider, null);
  const source = normalizeSource(options.source, null);
  const windowMs = clamp(
    Math.round(toSafeNumber(options.windowMs, DEFAULT_WINDOW_MS)),
    60_000,
    30 * 24 * 60 * 60 * 1000
  );
  const minTs = new Date(nowTs() - windowMs);
  const mongoReady = isMongoQuantumReliabilityReady();
  const memorySampleCount = filterMemorySamples(provider, minTs, source).length;

  let mongoSampleCount = 0;
  if (mongoReady) {
    const query = { ts: { $gte: minTs } };
    if (provider) {
      query.provider = provider.toLowerCase();
    }
    if (source) {
      query.source = source;
    }
    mongoSampleCount = await QuantumProviderSample.countDocuments(query);
  }

  return {
    generated_at: new Date().toISOString(),
    window_ms: windowMs,
    provider: provider || null,
    source: source || null,
    mongo_ready: mongoReady,
    memory_sample_count: memorySampleCount,
    mongo_sample_count: mongoSampleCount,
    retention_ms: RETENTION_MS,
    memory_max_samples: MEMORY_MAX_SAMPLES,
  };
}

function clearQuantumReliabilityMemoryStore() {
  memorySamples.splice(0, memorySamples.length);
}

module.exports = {
  isMongoQuantumReliabilityReady,
  recordQuantumProviderSample,
  listQuantumProviderSamples,
  getQuantumReliabilityStoreStatus,
  __test__: {
    clearQuantumReliabilityMemoryStore,
  },
};
