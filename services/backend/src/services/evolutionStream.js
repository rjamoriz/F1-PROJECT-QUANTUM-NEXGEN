/**
 * Evolution WebSocket stream manager.
 * Broadcasts telemetry and digital-twin updates with auth + rate-limit guards.
 */

const logger = require('../utils/logger');
const { verifyAccessToken, resolveAllowedCars } = require('./authTokens');
const { recordAuditEvent } = require('./auditLogStore');

let webSocketServer = null;
let heartbeatHandle = null;
const clients = new Set();
let streamPath = '/ws/evolution';
let streamStartedAtMs = null;

const AUTH_REQUIRED = String(process.env.EVOLUTION_WS_AUTH_REQUIRED || 'true').toLowerCase() !== 'false';
const AUTH_REQUIRE_SESSION = String(process.env.EVOLUTION_WS_REQUIRE_SESSION || process.env.AUTH_REQUIRE_SESSION || 'true').toLowerCase() !== 'false';
const ENFORCE_PERSISTED_ACL = String(process.env.EVOLUTION_WS_ENFORCE_PERSISTED_ACL || 'true').toLowerCase() !== 'false';
const FAIL_ON_ACL_STORE_UNAVAILABLE = String(process.env.EVOLUTION_WS_FAIL_ON_ACL_STORE_UNAVAILABLE || 'true').toLowerCase() !== 'false';
const DEFAULT_ALLOWED_CARS = String(process.env.EVOLUTION_WS_DEFAULT_ALLOWED_CARS || 'car-44')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const MAX_BUFFERED_BYTES = Number.isFinite(Number(process.env.EVOLUTION_WS_MAX_BUFFERED_BYTES))
  ? Number(process.env.EVOLUTION_WS_MAX_BUFFERED_BYTES)
  : 1024 * 1024;
const MAX_DROPPED_BEFORE_CLOSE = Number.isFinite(Number(process.env.EVOLUTION_WS_MAX_DROPPED_BEFORE_CLOSE))
  ? Number(process.env.EVOLUTION_WS_MAX_DROPPED_BEFORE_CLOSE)
  : 20;
const MAX_MSG_PER_WINDOW = Number.isFinite(Number(process.env.EVOLUTION_WS_MAX_MESSAGES_PER_WINDOW))
  ? Number(process.env.EVOLUTION_WS_MAX_MESSAGES_PER_WINDOW)
  : 180;
const MAX_SUBSCRIBE_PER_WINDOW = Number.isFinite(Number(process.env.EVOLUTION_WS_MAX_SUBSCRIBE_PER_WINDOW))
  ? Number(process.env.EVOLUTION_WS_MAX_SUBSCRIBE_PER_WINDOW)
  : 30;
const WINDOW_MS = Number.isFinite(Number(process.env.EVOLUTION_WS_RATE_WINDOW_MS))
  ? Number(process.env.EVOLUTION_WS_RATE_WINDOW_MS)
  : 60_000;
const MAX_CARS_PER_SUBSCRIBE = Number.isFinite(Number(process.env.EVOLUTION_WS_MAX_CARS_PER_SUBSCRIPTION))
  ? Number(process.env.EVOLUTION_WS_MAX_CARS_PER_SUBSCRIPTION)
  : 8;
const PROTECTION_MODE_DEFAULT = String(process.env.EVOLUTION_WS_PROTECTION_MODE || 'normal').trim().toLowerCase();
const PROTECTION_MODE_PROFILES = {
  normal: {
    max_buffered_bytes_multiplier: 1,
    max_dropped_before_close_multiplier: 1,
    max_messages_per_window_multiplier: 1,
    max_subscribe_per_window_multiplier: 1,
    rate_window_ms_multiplier: 1,
    max_cars_per_subscription_multiplier: 1,
  },
  elevated: {
    max_buffered_bytes_multiplier: 0.9,
    max_dropped_before_close_multiplier: 0.75,
    max_messages_per_window_multiplier: 0.7,
    max_subscribe_per_window_multiplier: 0.65,
    rate_window_ms_multiplier: 1.1,
    max_cars_per_subscription_multiplier: 0.8,
  },
  strict: {
    max_buffered_bytes_multiplier: 0.8,
    max_dropped_before_close_multiplier: 0.55,
    max_messages_per_window_multiplier: 0.45,
    max_subscribe_per_window_multiplier: 0.4,
    rate_window_ms_multiplier: 1.2,
    max_cars_per_subscription_multiplier: 0.5,
  },
};

const streamMetrics = {
  published_events: 0,
  delivered_messages: 0,
  events_by_type: {},
  dropped_messages: 0,
  rate_limited_messages: 0,
  auth_failures: 0,
  unauthorized_subscriptions: 0,
  rejected_connections: 0,
};
let protectionState = {
  mode: Object.prototype.hasOwnProperty.call(PROTECTION_MODE_PROFILES, PROTECTION_MODE_DEFAULT)
    ? PROTECTION_MODE_DEFAULT
    : 'normal',
  source: 'env',
  reason: 'startup_default',
  updated_at: new Date().toISOString(),
};

function normalizeProtectionMode(mode = 'normal') {
  const normalized = String(mode || 'normal').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PROTECTION_MODE_PROFILES, normalized)) {
    return normalized;
  }
  return null;
}

function toBoundedFloor(value, minimum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return minimum;
  }
  return Math.max(minimum, Math.floor(numeric));
}

function getEffectiveStreamLimits(mode = protectionState.mode) {
  const profileMode = normalizeProtectionMode(mode) || 'normal';
  const profile = PROTECTION_MODE_PROFILES[profileMode] || PROTECTION_MODE_PROFILES.normal;

  return {
    max_buffered_bytes: toBoundedFloor(MAX_BUFFERED_BYTES * profile.max_buffered_bytes_multiplier, 1),
    max_dropped_before_close: toBoundedFloor(MAX_DROPPED_BEFORE_CLOSE * profile.max_dropped_before_close_multiplier, 1),
    max_messages_per_window: toBoundedFloor(MAX_MSG_PER_WINDOW * profile.max_messages_per_window_multiplier, 1),
    max_subscribe_per_window: toBoundedFloor(MAX_SUBSCRIBE_PER_WINDOW * profile.max_subscribe_per_window_multiplier, 1),
    rate_window_ms: toBoundedFloor(WINDOW_MS * profile.rate_window_ms_multiplier, 100),
    max_cars_per_subscription: toBoundedFloor(MAX_CARS_PER_SUBSCRIBE * profile.max_cars_per_subscription_multiplier, 1),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function toJson(payload) {
  try {
    return JSON.stringify(payload);
  } catch (_error) {
    return JSON.stringify({
      type: 'stream_error',
      timestamp: nowIso(),
      data: { message: 'serialization_failed' },
    });
  }
}

function parseUrlSearch(rawUrl = '') {
  const queryIndex = String(rawUrl).indexOf('?');
  if (queryIndex === -1) {
    return new URLSearchParams();
  }
  return new URLSearchParams(String(rawUrl).slice(queryIndex + 1));
}

function extractBearerToken(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.toLowerCase().startsWith('bearer ')) {
    return text.slice('bearer '.length).trim() || null;
  }
  return text;
}

function resolveTokenFromRequest(request = {}) {
  const authHeader = request?.headers?.authorization;
  const bearer = extractBearerToken(authHeader);
  if (bearer) return bearer;

  const search = parseUrlSearch(request?.url || '');
  const queryToken = search.get('token') || search.get('access_token');
  if (queryToken) return String(queryToken).trim();

  return null;
}

function normalizeCarIds(raw) {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (raw && typeof raw === 'object') {
    return Object.values(raw).map((value) => String(value || '').trim()).filter(Boolean);
  }
  if (raw) {
    return [String(raw).trim()].filter(Boolean);
  }
  return [];
}

function getAuthorizedCarsFromClaims(claims = {}) {
  const role = String(claims.role || 'viewer').toLowerCase();
  if (role === 'admin') {
    return new Set(['*']);
  }

  const fromClaims = [
    ...normalizeCarIds(claims.car_ids),
    ...normalizeCarIds(claims.allowed_car_ids),
    ...normalizeCarIds(claims.car_id),
  ];

  const resolved = fromClaims.length > 0 ? fromClaims : DEFAULT_ALLOWED_CARS;
  if (resolved.length === 0) {
    return new Set(['car-44']);
  }

  return new Set(resolved);
}

async function authenticateRequest(request = {}) {
  if (!AUTH_REQUIRED) {
    return {
      ok: true,
      claims: {
        role: 'admin',
        email: 'stream-open@local',
        sub: 'stream-open',
      },
      authorizedCars: new Set(['*']),
      tokenPresent: false,
    };
  }

  const token = resolveTokenFromRequest(request);
  if (!token) {
    return {
      ok: false,
      reason: 'missing_token',
    };
  }

  const verified = await verifyAccessToken(token, {
    requireSession: AUTH_REQUIRE_SESSION,
    requirePersistedUser: ENFORCE_PERSISTED_ACL,
    failOnPersistenceUnavailable: ENFORCE_PERSISTED_ACL && FAIL_ON_ACL_STORE_UNAVAILABLE,
  });
  if (!verified.ok) {
    return {
      ok: false,
      reason: verified.reason || 'invalid_token',
    };
  }

  const effectiveClaims = {
    ...verified.claims,
    role: verified.role || verified.claims?.role || 'viewer',
    allowed_car_ids: Array.isArray(verified.allowed_car_ids)
      ? verified.allowed_car_ids
      : verified.claims?.allowed_car_ids,
  };
  const authorizedCars = new Set(resolveAllowedCars(effectiveClaims));

  return {
    ok: true,
    claims: effectiveClaims,
    authorizedCars: authorizedCars.size > 0 ? authorizedCars : getAuthorizedCarsFromClaims(effectiveClaims),
    tokenPresent: true,
    user: verified.user || null,
    session: verified.session || null,
  };
}

function isAdminSocket(socket) {
  const role = String(socket?._auth?.claims?.role || '').toLowerCase();
  return role === 'admin';
}

function normalizeChannels(channels) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return new Set(['telemetry', 'digital_twin']);
  }

  const normalized = channels
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((value) => value === 'telemetry' || value === 'digital_twin');
  if (normalized.length === 0) {
    return new Set(['telemetry', 'digital_twin']);
  }
  return new Set(normalized);
}

function normalizeRequestedCars(carId) {
  const ids = normalizeCarIds(carId);
  if (ids.length === 0) {
    return new Set();
  }
  const effectiveLimits = getEffectiveStreamLimits();
  return new Set(ids.slice(0, effectiveLimits.max_cars_per_subscription));
}

function applyCarAuthorization(socket, requestedCars) {
  const authorizedCars = socket?._auth?.authorizedCars || new Set(['*']);
  if (authorizedCars.has('*')) {
    if (requestedCars.size === 0) {
      return {
        ok: true,
        cars: new Set(['*']),
      };
    }
    return {
      ok: true,
      cars: requestedCars,
    };
  }

  if (requestedCars.size === 0) {
    return {
      ok: true,
      cars: new Set([...authorizedCars]),
    };
  }

  const unauthorized = [...requestedCars].filter((id) => !authorizedCars.has(id));
  if (unauthorized.length > 0) {
    streamMetrics.unauthorized_subscriptions += 1;
    return {
      ok: false,
      reason: `unauthorized_car_ids:${unauthorized.join(',')}`,
    };
  }

  return {
    ok: true,
    cars: requestedCars,
  };
}

function resolveChannelForType(eventType) {
  if (eventType === 'telemetry_update') return 'telemetry';
  if (eventType === 'digital_twin_update') return 'digital_twin';
  return null;
}

function shouldDeliver(client, eventType, meta = {}) {
  const channel = resolveChannelForType(eventType);
  const state = client._evolutionSubscription || {};
  const channels = state.channels || new Set(['telemetry', 'digital_twin']);
  const carIds = state.carIds || new Set(['*']);

  if (channel && !channels.has(channel)) {
    return false;
  }

  if (!meta.car_id || carIds.has('*')) {
    return true;
  }

  return carIds.has(String(meta.car_id));
}

function sendToClient(client, payload) {
  if (!client || client.readyState !== 1) {
    return false;
  }

  const limits = getEffectiveStreamLimits();
  if (toNumber(client.bufferedAmount, 0) > limits.max_buffered_bytes) {
    client._droppedMessages = toNumber(client._droppedMessages, 0) + 1;
    streamMetrics.dropped_messages += 1;

    if (client._droppedMessages >= limits.max_dropped_before_close) {
      try {
        client.close(1013, 'Backpressure');
      } catch (_error) {
        // no-op
      }
    }
    return false;
  }

  client.send(toJson(payload));
  client._droppedMessages = 0;
  return true;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function checkRateLimit(socket, kind = 'message') {
  const now = Date.now();
  const limits = getEffectiveStreamLimits();
  if (!socket._rateState || socket._rateState.windowDurationMs !== limits.rate_window_ms) {
    socket._rateState = {
      windowStartMs: now,
      windowDurationMs: limits.rate_window_ms,
      messageCount: 0,
      subscribeCount: 0,
    };
  }

  if (now - socket._rateState.windowStartMs >= socket._rateState.windowDurationMs) {
    socket._rateState.windowStartMs = now;
    socket._rateState.messageCount = 0;
    socket._rateState.subscribeCount = 0;
  }

  socket._rateState.messageCount += 1;
  if (socket._rateState.messageCount > limits.max_messages_per_window) {
    streamMetrics.rate_limited_messages += 1;
    return {
      ok: false,
      reason: 'message_rate_limited',
    };
  }

  if (kind === 'subscribe') {
    socket._rateState.subscribeCount += 1;
    if (socket._rateState.subscribeCount > limits.max_subscribe_per_window) {
      streamMetrics.rate_limited_messages += 1;
      return {
        ok: false,
        reason: 'subscribe_rate_limited',
      };
    }
  }

  return { ok: true };
}

function publishEvolutionEvent(eventType, data, meta = {}) {
  if (!eventType || clients.size === 0) {
    return;
  }

  streamMetrics.published_events += 1;
  streamMetrics.events_by_type[eventType] = (streamMetrics.events_by_type[eventType] || 0) + 1;

  const payload = {
    type: eventType,
    timestamp: nowIso(),
    data,
  };

  clients.forEach((client) => {
    if (!shouldDeliver(client, eventType, meta)) {
      return;
    }
    const delivered = sendToClient(client, payload);
    if (delivered) {
      streamMetrics.delivered_messages += 1;
    }
  });
}

function sendError(socket, message, code = 'STREAM_ERROR') {
  sendToClient(socket, {
    type: 'stream_error',
    timestamp: nowIso(),
    data: {
      code,
      message,
    },
  });
}

function resolveRequestIp(request = {}) {
  return (
    request?.headers?.['x-forwarded-for']
    || request?.socket?.remoteAddress
    || null
  );
}

function safeRecordStreamAudit(event = {}) {
  recordAuditEvent({
    category: 'evolution',
    source: 'ws',
    ...event,
  }).catch(() => {
    // no-op: websocket flow must not await audit persistence
  });
}

function getEvolutionStreamProtectionState() {
  const mode = normalizeProtectionMode(protectionState.mode) || 'normal';
  const effectiveLimits = getEffectiveStreamLimits(mode);
  return {
    mode,
    source: String(protectionState.source || 'runtime'),
    reason: String(protectionState.reason || 'manual'),
    updated_at: String(protectionState.updated_at || nowIso()),
    available_modes: Object.keys(PROTECTION_MODE_PROFILES),
    effective_limits: effectiveLimits,
  };
}

function setEvolutionStreamProtectionMode(mode, {
  source = 'api',
  reason = 'manual_override',
} = {}) {
  const normalizedMode = normalizeProtectionMode(mode);
  if (!normalizedMode) {
    return {
      ok: false,
      error: 'unsupported_mode',
      requested_mode: String(mode || ''),
      available_modes: Object.keys(PROTECTION_MODE_PROFILES),
      state: getEvolutionStreamProtectionState(),
    };
  }

  const previousMode = normalizeProtectionMode(protectionState.mode) || 'normal';
  const changed = previousMode !== normalizedMode;
  protectionState = {
    mode: normalizedMode,
    source: String(source || 'api'),
    reason: String(reason || 'manual_override'),
    updated_at: nowIso(),
  };

  if (changed) {
    logger.warn(
      `Evolution stream protection mode changed ${previousMode} -> ${normalizedMode} (${protectionState.reason})`
    );
    const payload = {
      type: 'stream_policy_update',
      timestamp: nowIso(),
      data: getEvolutionStreamProtectionState(),
    };
    clients.forEach((client) => {
      sendToClient(client, payload);
    });
  }

  return {
    ok: true,
    changed,
    previous_mode: previousMode,
    state: getEvolutionStreamProtectionState(),
  };
}

function attachEvolutionWebSocketServer(server) {
  if (webSocketServer) {
    return {
      enabled: true,
      clients,
      close: closeEvolutionWebSocketServer,
    };
  }

  let wsModule;
  try {
    wsModule = require('ws');
  } catch (error) {
    logger.warn(`Evolution WebSocket disabled: ${error.message}`);
    return {
      enabled: false,
      clients,
      close: async () => {},
    };
  }

  const wsPath = process.env.EVOLUTION_WS_PATH || '/ws/evolution';
  streamPath = wsPath;
  streamStartedAtMs = Date.now();
  streamMetrics.published_events = 0;
  streamMetrics.delivered_messages = 0;
  streamMetrics.events_by_type = {};
  streamMetrics.dropped_messages = 0;
  streamMetrics.rate_limited_messages = 0;
  streamMetrics.auth_failures = 0;
  streamMetrics.unauthorized_subscriptions = 0;
  streamMetrics.rejected_connections = 0;

  const { WebSocketServer } = wsModule;
  webSocketServer = new WebSocketServer({
    server,
    path: wsPath,
  });

  async function handleSocketConnection(socket, request) {
    const auth = await authenticateRequest(request);
    if (!auth.ok) {
      streamMetrics.auth_failures += 1;
      streamMetrics.rejected_connections += 1;
      safeRecordStreamAudit({
        action: 'evolution.ws.connection_denied',
        outcome: 'denied',
        reason: auth.reason || 'authentication_failed',
        request_id: request?.headers?.['x-request-id'] || null,
        method: 'WS_CONNECT',
        path: request?.url || streamPath,
        ip: resolveRequestIp(request),
        user_agent: request?.headers?.['user-agent'] || null,
        metadata: {
          auth_required: AUTH_REQUIRED,
          auth_require_session: AUTH_REQUIRE_SESSION,
          enforce_persisted_acl: ENFORCE_PERSISTED_ACL,
        },
      });
      sendError(socket, auth.reason || 'authentication_failed', 'UNAUTHORIZED');
      try {
        socket.close(4401, 'Unauthorized');
      } catch (_error) {
        // no-op
      }
      return;
    }

    socket._auth = auth;
    socket._droppedMessages = 0;
    socket._rateState = {
      windowStartMs: Date.now(),
      windowDurationMs: getEffectiveStreamLimits().rate_window_ms,
      messageCount: 0,
      subscribeCount: 0,
    };
    socket._evolutionSubscription = {
      carIds: auth.authorizedCars.has('*') ? new Set(['*']) : new Set([...auth.authorizedCars]),
      channels: new Set(['telemetry', 'digital_twin']),
    };

    clients.add(socket);
    sendToClient(socket, {
      type: 'connected',
      timestamp: nowIso(),
      data: {
        path: wsPath,
        channels: ['telemetry', 'digital_twin'],
        auth_required: AUTH_REQUIRED,
        auth_require_session: AUTH_REQUIRE_SESSION,
        acl_source: ENFORCE_PERSISTED_ACL ? 'persistence+claims' : 'claims',
        role: String(auth?.claims?.role || 'viewer'),
        car_ids: [...socket._evolutionSubscription.carIds],
        user_id: auth?.claims?.sub || null,
        session_id: auth?.claims?.sid || null,
        protection_mode: getEvolutionStreamProtectionState().mode,
        limits: getEffectiveStreamLimits(),
      },
    });

    socket.on('message', (rawMessage) => {
      const messageLimit = checkRateLimit(socket, 'message');
      if (!messageLimit.ok) {
        sendError(socket, messageLimit.reason, 'RATE_LIMITED');
        return;
      }

      try {
        const message = JSON.parse(String(rawMessage || '{}'));
        const command = String(message.command || '').toLowerCase();

        if (command === 'subscribe') {
          const subscribeLimit = checkRateLimit(socket, 'subscribe');
          if (!subscribeLimit.ok) {
            sendError(socket, subscribeLimit.reason, 'RATE_LIMITED');
            return;
          }

          const requestedCars = normalizeRequestedCars(message.car_id || message.car_ids);
          const carAuth = applyCarAuthorization(socket, requestedCars);
          if (!carAuth.ok) {
            safeRecordStreamAudit({
              action: 'evolution.ws.acl_denied',
              outcome: 'denied',
              reason: carAuth.reason || 'forbidden',
              request_id: request?.headers?.['x-request-id'] || null,
              method: 'WS_SUBSCRIBE',
              path: request?.url || streamPath,
              ip: resolveRequestIp(request),
              user_agent: request?.headers?.['user-agent'] || null,
              actor_user_id: String(socket?._auth?.claims?.sub || '').trim() || null,
              actor_role: String(socket?._auth?.claims?.role || '').trim() || null,
              actor_email: String(socket?._auth?.claims?.email || '').trim().toLowerCase() || null,
              target_type: 'car',
              car_ids: [...requestedCars],
              metadata: {
                requested_channels: Array.isArray(message.channels) ? message.channels : [],
              },
            });
            sendError(socket, carAuth.reason || 'forbidden', 'FORBIDDEN');
            return;
          }

          socket._evolutionSubscription = {
            carIds: carAuth.cars,
            channels: normalizeChannels(message.channels),
          };

          sendToClient(socket, {
            type: 'subscribed',
            timestamp: nowIso(),
            data: {
              car_ids: [...socket._evolutionSubscription.carIds],
              channels: [...socket._evolutionSubscription.channels],
              role: String(socket?._auth?.claims?.role || 'viewer'),
            },
          });
          return;
        }

        if (command === 'ping') {
          sendToClient(socket, {
            type: 'pong',
            timestamp: nowIso(),
            data: {
              role: String(socket?._auth?.claims?.role || 'viewer'),
            },
          });
          return;
        }

        sendError(socket, 'unknown_command', 'BAD_COMMAND');
      } catch (_error) {
        sendError(socket, 'invalid_message', 'BAD_MESSAGE');
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
    });
  }

  webSocketServer.on('connection', (socket, request) => {
    handleSocketConnection(socket, request).catch((error) => {
      streamMetrics.auth_failures += 1;
      streamMetrics.rejected_connections += 1;
      safeRecordStreamAudit({
        action: 'evolution.ws.connection_denied',
        outcome: 'error',
        reason: error?.message || 'authentication_failed',
        request_id: request?.headers?.['x-request-id'] || null,
        method: 'WS_CONNECT',
        path: request?.url || streamPath,
        ip: resolveRequestIp(request),
        user_agent: request?.headers?.['user-agent'] || null,
      });
      sendError(socket, error?.message || 'authentication_failed', 'UNAUTHORIZED');
      try {
        socket.close(1011, 'Auth error');
      } catch (_closeError) {
        // no-op
      }
    });
  });

  heartbeatHandle = setInterval(() => {
    publishEvolutionEvent('heartbeat', {
      connected_clients: clients.size,
    });
  }, 15000);

  logger.info(`Evolution WebSocket stream active on path ${wsPath}`);

  return {
    enabled: true,
    clients,
    close: closeEvolutionWebSocketServer,
  };
}

async function closeEvolutionWebSocketServer() {
  if (heartbeatHandle) {
    clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  }

  if (!webSocketServer) {
    return;
  }

  clients.forEach((socket) => {
    try {
      socket.close();
    } catch (_error) {
      // no-op
    }
  });
  clients.clear();

  await new Promise((resolve) => webSocketServer.close(resolve));
  webSocketServer = null;
  streamStartedAtMs = null;
}

function getEvolutionStreamStatus() {
  const effectiveLimits = getEffectiveStreamLimits();
  return {
    enabled: Boolean(webSocketServer),
    path: streamPath,
    auth_required: AUTH_REQUIRED,
    auth_require_session: AUTH_REQUIRE_SESSION,
    enforce_persisted_acl: ENFORCE_PERSISTED_ACL,
    fail_on_acl_store_unavailable: FAIL_ON_ACL_STORE_UNAVAILABLE,
    connected_clients: clients.size,
    published_events: streamMetrics.published_events,
    delivered_messages: streamMetrics.delivered_messages,
    events_by_type: { ...streamMetrics.events_by_type },
    dropped_messages: streamMetrics.dropped_messages,
    rate_limited_messages: streamMetrics.rate_limited_messages,
    auth_failures: streamMetrics.auth_failures,
    unauthorized_subscriptions: streamMetrics.unauthorized_subscriptions,
    rejected_connections: streamMetrics.rejected_connections,
    limits: {
      max_buffered_bytes: MAX_BUFFERED_BYTES,
      max_dropped_before_close: MAX_DROPPED_BEFORE_CLOSE,
      max_messages_per_window: MAX_MSG_PER_WINDOW,
      max_subscribe_per_window: MAX_SUBSCRIBE_PER_WINDOW,
      rate_window_ms: WINDOW_MS,
      max_cars_per_subscription: MAX_CARS_PER_SUBSCRIBE,
    },
    effective_limits: effectiveLimits,
    protection: getEvolutionStreamProtectionState(),
    uptime_s: streamStartedAtMs
      ? Number(((Date.now() - streamStartedAtMs) / 1000).toFixed(3))
      : 0,
  };
}

module.exports = {
  attachEvolutionWebSocketServer,
  closeEvolutionWebSocketServer,
  publishEvolutionEvent,
  getEvolutionStreamStatus,
  setEvolutionStreamProtectionMode,
  getEvolutionStreamProtectionState,
  __test__: {
    parseUrlSearch,
    extractBearerToken,
    resolveTokenFromRequest,
    normalizeCarIds,
    getAuthorizedCarsFromClaims,
    authenticateRequest,
    normalizeChannels,
    normalizeRequestedCars,
    applyCarAuthorization,
    resolveChannelForType,
    shouldDeliver,
    checkRateLimit,
    sendToClient,
    normalizeProtectionMode,
    getEffectiveStreamLimits,
    resetStreamMetrics: () => {
      streamMetrics.published_events = 0;
      streamMetrics.delivered_messages = 0;
      streamMetrics.events_by_type = {};
      streamMetrics.dropped_messages = 0;
      streamMetrics.rate_limited_messages = 0;
      streamMetrics.auth_failures = 0;
      streamMetrics.unauthorized_subscriptions = 0;
      streamMetrics.rejected_connections = 0;
    },
    resetProtectionMode: () => {
      protectionState = {
        mode: Object.prototype.hasOwnProperty.call(PROTECTION_MODE_PROFILES, PROTECTION_MODE_DEFAULT)
          ? PROTECTION_MODE_DEFAULT
          : 'normal',
        source: 'env',
        reason: 'startup_default',
        updated_at: nowIso(),
      };
    },
  },
};
