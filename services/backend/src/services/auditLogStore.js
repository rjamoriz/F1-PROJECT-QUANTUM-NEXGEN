const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const AuditEvent = require('../models/AuditEvent');

const MEMORY_AUDIT_MAX_EVENTS = Number.isFinite(Number(process.env.AUDIT_MEMORY_MAX_EVENTS))
  ? Math.max(250, Number(process.env.AUDIT_MEMORY_MAX_EVENTS))
  : 5000;

const memoryAuditEvents = [];

function now() {
  return new Date();
}

function toDate(value, fallback = null) {
  if (!value) return fallback;
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

function normalizeCarIds(raw) {
  const source = Array.isArray(raw)
    ? raw
    : String(raw || '')
      .split(',');

  const normalized = source
    .map((value) => normalizeString(value, null))
    .filter(Boolean);

  return [...new Set(normalized)].slice(0, 32);
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const output = {};
  Object.entries(value).forEach(([key, raw]) => {
    const safeKey = normalizeString(key, null);
    if (!safeKey) return;

    if (raw === undefined) return;
    if (raw === null) {
      output[safeKey] = null;
      return;
    }

    if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') {
      output[safeKey] = raw;
      return;
    }

    if (Array.isArray(raw)) {
      output[safeKey] = raw.slice(0, 25);
      return;
    }

    try {
      output[safeKey] = JSON.parse(JSON.stringify(raw));
    } catch (_error) {
      output[safeKey] = String(raw);
    }
  });

  return output;
}

function normalizeAuditEvent(input = {}) {
  const createdAt = toDate(input.created_at, now()) || now();
  return {
    event_id: normalizeString(input.event_id, randomUUID()),
    category: normalizeString(input.category, 'system'),
    action: normalizeString(input.action, 'event'),
    outcome: ['success', 'denied', 'error', 'info'].includes(String(input.outcome || '').toLowerCase())
      ? String(input.outcome || '').toLowerCase()
      : 'info',
    source: normalizeString(input.source, 'http'),
    actor_user_id: normalizeString(input.actor_user_id, null),
    actor_role: normalizeString(input.actor_role, null),
    actor_email: normalizeString(input.actor_email, null),
    target_type: normalizeString(input.target_type, null),
    target_id: normalizeString(input.target_id, null),
    car_ids: normalizeCarIds(input.car_ids),
    reason: normalizeString(input.reason, null),
    request_id: normalizeString(input.request_id, null),
    method: normalizeString(input.method, null),
    path: normalizeString(input.path, null),
    ip: normalizeString(input.ip, null),
    user_agent: normalizeString(input.user_agent, null),
    metadata: normalizeMetadata(input.metadata),
    created_at: createdAt,
  };
}

function serializeAuditEvent(event = {}) {
  const normalized = normalizeAuditEvent(event);
  return {
    ...normalized,
    created_at: normalized.created_at.toISOString(),
  };
}

function isMongoAuditReady() {
  return mongoose?.connection?.readyState === 1 && AuditEvent?.db?.readyState === 1;
}

function trimMemoryStoreIfNeeded() {
  if (memoryAuditEvents.length <= MEMORY_AUDIT_MAX_EVENTS) {
    return;
  }
  const overflow = memoryAuditEvents.length - MEMORY_AUDIT_MAX_EVENTS;
  if (overflow > 0) {
    memoryAuditEvents.splice(0, overflow);
  }
}

async function recordAuditEvent(input = {}) {
  const event = normalizeAuditEvent(input);

  if (isMongoAuditReady()) {
    const persisted = await AuditEvent.create(event);
    return serializeAuditEvent(persisted.toObject ? persisted.toObject() : persisted);
  }

  memoryAuditEvents.push(event);
  trimMemoryStoreIfNeeded();
  return serializeAuditEvent(event);
}

function buildFilterMatcher(filters = {}) {
  const category = normalizeString(filters.category, null);
  const action = normalizeString(filters.action, null);
  const outcome = normalizeString(filters.outcome, null);
  const actorUserId = normalizeString(filters.actor_user_id, null);
  const targetId = normalizeString(filters.target_id, null);
  const requestId = normalizeString(filters.request_id, null);
  const since = toDate(filters.since, null);
  const until = toDate(filters.until, null);

  return (event = {}) => {
    if (category && event.category !== category) return false;
    if (action && event.action !== action) return false;
    if (outcome && event.outcome !== outcome) return false;
    if (actorUserId && event.actor_user_id !== actorUserId) return false;
    if (targetId && event.target_id !== targetId) return false;
    if (requestId && event.request_id !== requestId) return false;

    const createdAt = toDate(event.created_at, null);
    if (since && createdAt && createdAt.getTime() < since.getTime()) return false;
    if (until && createdAt && createdAt.getTime() > until.getTime()) return false;

    return true;
  };
}

async function listAuditEvents(filters = {}) {
  const limit = Number.isFinite(Number(filters.limit))
    ? Math.min(Math.max(Number(filters.limit), 1), 250)
    : 50;

  if (isMongoAuditReady()) {
    const query = {};
    const category = normalizeString(filters.category, null);
    const action = normalizeString(filters.action, null);
    const outcome = normalizeString(filters.outcome, null);
    const actorUserId = normalizeString(filters.actor_user_id, null);
    const targetId = normalizeString(filters.target_id, null);
    const requestId = normalizeString(filters.request_id, null);

    if (category) query.category = category;
    if (action) query.action = action;
    if (outcome) query.outcome = outcome;
    if (actorUserId) query.actor_user_id = actorUserId;
    if (targetId) query.target_id = targetId;
    if (requestId) query.request_id = requestId;

    const since = toDate(filters.since, null);
    const until = toDate(filters.until, null);
    if (since || until) {
      query.created_at = {};
      if (since) query.created_at.$gte = since;
      if (until) query.created_at.$lte = until;
    }

    const records = await AuditEvent.find(query)
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();

    return records.map((record) => serializeAuditEvent(record));
  }

  const matcher = buildFilterMatcher(filters);
  return memoryAuditEvents
    .filter(matcher)
    .sort((a, b) => toDate(b.created_at, new Date(0)).getTime() - toDate(a.created_at, new Date(0)).getTime())
    .slice(0, limit)
    .map((record) => serializeAuditEvent(record));
}

async function summarizeAuditEvents(options = {}) {
  const windowMinutes = Number.isFinite(Number(options.window_minutes))
    ? Math.min(Math.max(Number(options.window_minutes), 1), 24 * 60 * 14)
    : 60;
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  const events = await listAuditEvents({
    since,
    limit: 250,
  });

  const byOutcome = {};
  const byCategory = {};
  const byAction = {};

  events.forEach((event) => {
    byOutcome[event.outcome] = (byOutcome[event.outcome] || 0) + 1;
    byCategory[event.category] = (byCategory[event.category] || 0) + 1;
    byAction[event.action] = (byAction[event.action] || 0) + 1;
  });

  const topActions = Object.entries(byAction)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([action, count]) => ({ action, count }));

  const keyEvents = {
    acl_denied: events.filter((event) => event.action.includes('acl_denied')).length,
    auth_denied: events.filter((event) => event.action.includes('auth_denied') || event.action.includes('connection_denied')).length,
    policy_updates: events.filter((event) => event.action === 'policy.allowed_car_ids.update').length,
    ws_denied: events.filter((event) => event.source === 'ws' && event.outcome === 'denied').length,
  };

  return {
    generated_at: now().toISOString(),
    window_minutes: windowMinutes,
    total_events: events.length,
    by_outcome: byOutcome,
    by_category: byCategory,
    top_actions: topActions,
    key_events: keyEvents,
  };
}

function clearAuditMemoryStore() {
  memoryAuditEvents.splice(0, memoryAuditEvents.length);
}

module.exports = {
  isMongoAuditReady,
  recordAuditEvent,
  listAuditEvents,
  summarizeAuditEvents,
  __test__: {
    clearAuditMemoryStore,
  },
};
