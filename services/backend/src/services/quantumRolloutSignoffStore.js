const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const QuantumRolloutSignoff = require('../models/QuantumRolloutSignoff');
const logger = require('../utils/logger');

const MEMORY_MAX_RECORDS = Number.isFinite(Number(process.env.QUANTUM_ROLLOUT_SIGNOFF_MEMORY_MAX_RECORDS))
  ? clamp(Math.round(Number(process.env.QUANTUM_ROLLOUT_SIGNOFF_MEMORY_MAX_RECORDS)), 50, 10000)
  : 2000;
const RETENTION_MS = Number.isFinite(Number(process.env.QUANTUM_ROLLOUT_SIGNOFF_RETENTION_MS))
  ? clamp(Math.round(Number(process.env.QUANTUM_ROLLOUT_SIGNOFF_RETENTION_MS)), 60_000, 180 * 24 * 60 * 60 * 1000)
  : 30 * 24 * 60 * 60 * 1000;

const memorySignoffs = [];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function nowTs() {
  return Date.now();
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

function normalizeString(value, fallback = null) {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeSource(value, fallback = null) {
  const source = normalizeString(value, fallback);
  return source ? source.toLowerCase() : fallback;
}

function normalizeEnvironment(value, fallback = 'unknown') {
  const normalized = normalizeString(value, fallback);
  return normalized ? normalized.toLowerCase() : fallback;
}

function normalizeStatus(value, fallback = 'blocked') {
  const normalizedRaw = normalizeString(value, fallback);
  if (!normalizedRaw) {
    return fallback;
  }
  const normalized = String(normalizedRaw).toLowerCase();
  if (['approved', 'blocked', 'error'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeConfidence(value, fallback = 'low') {
  const normalized = normalizeString(value, fallback).toLowerCase();
  if (['low', 'medium', 'high', 'unknown'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values
    .map((entry) => normalizeString(entry, null))
    .filter(Boolean)
  )].slice(0, 64);
}

function normalizeObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return fallback;
  }
}

function normalizeSignoff(input = {}) {
  const createdAt = toDate(input.created_at, new Date()) || new Date();
  const status = normalizeStatus(input.status, input.approved === true ? 'approved' : 'blocked');
  const approved = input.approved === true || status === 'approved';

  return {
    signoff_id: normalizeString(input.signoff_id, randomUUID()),
    environment: normalizeEnvironment(input.environment, 'unknown'),
    source: normalizeSource(input.source, null),
    status,
    approved,
    readiness_status: normalizeString(input.readiness_status, approved ? 'approved' : 'review_required'),
    confidence_level: normalizeConfidence(input.confidence_level, 'unknown'),
    calibration_source: normalizeString(input.calibration_source, null),
    blockers: normalizeStringList(input.blockers),
    policy: normalizeObject(input.policy, {}),
    windows: normalizeObject(input.windows, {}),
    sample_counts: normalizeObject(input.sample_counts, {}),
    source_status_summary: normalizeObject(input.source_status_summary, {}),
    storage_status: normalizeObject(input.storage_status, {}),
    report: normalizeObject(input.report, {}),
    created_at: createdAt,
  };
}

function serializeSignoff(record = {}) {
  const normalized = normalizeSignoff(record);
  return {
    ...normalized,
    created_at: normalized.created_at.toISOString(),
  };
}

function isMongoQuantumRolloutSignoffReady() {
  return mongoose?.connection?.readyState === 1 && QuantumRolloutSignoff?.db?.readyState === 1;
}

function pruneMemorySignoffsIfNeeded() {
  const oldestAllowedTs = nowTs() - RETENTION_MS;

  while (memorySignoffs.length > 0) {
    const first = memorySignoffs[0];
    const firstTs = toDate(first.created_at, null);
    if (!firstTs || firstTs.getTime() < oldestAllowedTs) {
      memorySignoffs.shift();
    } else {
      break;
    }
  }

  while (memorySignoffs.length > MEMORY_MAX_RECORDS) {
    memorySignoffs.shift();
  }
}

function filterMemorySignoffs(filters = {}) {
  const environment = normalizeEnvironment(filters.environment, null);
  const source = normalizeSource(filters.source, null);
  const status = normalizeStatus(filters.status, null);
  const approvedFilter = filters.approved;

  return memorySignoffs.filter((entry) => {
    if (environment && normalizeEnvironment(entry.environment, null) !== environment) return false;
    if (source && normalizeSource(entry.source, null) !== source) return false;
    if (status && normalizeStatus(entry.status, '') !== status) return false;
    if (approvedFilter === true && entry.approved !== true) return false;
    if (approvedFilter === false && entry.approved !== false) return false;
    return true;
  });
}

function dedupeSignoffs(signoffs = []) {
  const byId = new Map();
  signoffs.forEach((entry) => {
    const serialized = serializeSignoff(entry);
    byId.set(serialized.signoff_id, serialized);
  });
  return [...byId.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

async function recordQuantumRolloutSignoff(input = {}) {
  const normalized = normalizeSignoff(input);
  memorySignoffs.push(normalized);
  pruneMemorySignoffsIfNeeded();

  if (isMongoQuantumRolloutSignoffReady()) {
    try {
      await QuantumRolloutSignoff.create(normalized);
    } catch (error) {
      logger.warn(`Quantum rollout signoff persistence failed: ${error.message}`);
    }
  }

  return serializeSignoff(normalized);
}

async function listQuantumRolloutSignoffs(filters = {}) {
  const limit = clamp(
    Math.round(Number(filters.limit) || 20),
    1,
    250
  );

  const environment = normalizeEnvironment(filters.environment, null);
  const source = normalizeSource(filters.source, null);
  const status = normalizeStatus(filters.status, null);

  const approvedFilter = (() => {
    if (filters.approved === true || String(filters.approved).toLowerCase() === 'true') return true;
    if (filters.approved === false || String(filters.approved).toLowerCase() === 'false') return false;
    return null;
  })();

  const memoryRecords = filterMemorySignoffs({
    environment,
    source,
    status,
    approved: approvedFilter,
  });
  let mongoRecords = [];

  if (isMongoQuantumRolloutSignoffReady()) {
    const query = {};
    if (environment) query.environment = environment;
    if (source) query.source = source;
    if (status) query.status = status;
    if (approvedFilter !== null) query.approved = approvedFilter;

    mongoRecords = await QuantumRolloutSignoff.find(query)
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();
  }

  const merged = dedupeSignoffs([...mongoRecords, ...memoryRecords]);
  return merged.slice(0, limit);
}

async function getLatestQuantumRolloutSignoff(filters = {}) {
  const records = await listQuantumRolloutSignoffs({
    ...filters,
    limit: 1,
  });
  return records[0] || null;
}

async function getQuantumRolloutSignoffStoreStatus(filters = {}) {
  const environment = normalizeEnvironment(filters.environment, null);
  const source = normalizeSource(filters.source, null);
  const status = normalizeStatus(filters.status, null);
  const mongoReady = isMongoQuantumRolloutSignoffReady();

  let mongoRecordCount = 0;
  if (mongoReady) {
    const query = {};
    if (environment) query.environment = environment;
    if (source) query.source = source;
    if (status) query.status = status;
    mongoRecordCount = await QuantumRolloutSignoff.countDocuments(query);
  }

  const memoryRecordCount = filterMemorySignoffs({
    environment,
    source,
    status,
  }).length;

  return {
    generated_at: new Date().toISOString(),
    environment: environment || null,
    source: source || null,
    status: status || null,
    mongo_ready: mongoReady,
    memory_record_count: memoryRecordCount,
    mongo_record_count: mongoRecordCount,
    retention_ms: RETENTION_MS,
    memory_max_records: MEMORY_MAX_RECORDS,
  };
}

function clearQuantumRolloutSignoffMemoryStore() {
  memorySignoffs.splice(0, memorySignoffs.length);
}

module.exports = {
  isMongoQuantumRolloutSignoffReady,
  recordQuantumRolloutSignoff,
  listQuantumRolloutSignoffs,
  getLatestQuantumRolloutSignoff,
  getQuantumRolloutSignoffStoreStatus,
  __test__: {
    clearQuantumRolloutSignoffMemoryStore,
  },
};
