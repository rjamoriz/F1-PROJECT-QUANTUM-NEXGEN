const { createHash, randomBytes, randomUUID } = require('crypto');
const mongoose = require('mongoose');
const AuthSession = require('../models/AuthSession');

const REFRESH_TOKEN_PEPPER = process.env.REFRESH_TOKEN_PEPPER || process.env.JWT_SECRET || 'qaero-local-dev-secret';
const MEMORY_STORE_MAX_SESSIONS = Number.isFinite(Number(process.env.AUTH_SESSION_MEMORY_LIMIT))
  ? Math.max(100, Number(process.env.AUTH_SESSION_MEMORY_LIMIT))
  : 5000;

const memorySessionsById = new Map();
const memorySessionIdByRefreshHash = new Map();

function now() {
  return new Date();
}

function toDate(value, fallback = now()) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed;
}

function isMongoSessionReady() {
  return mongoose?.connection?.readyState === 1 && AuthSession?.db?.readyState === 1;
}

function hashRefreshToken(refreshToken) {
  return createHash('sha256')
    .update(`${REFRESH_TOKEN_PEPPER}:${String(refreshToken || '').trim()}`)
    .digest('hex');
}

function generateRefreshToken() {
  return randomBytes(48).toString('base64url');
}

function normalizeSession(session = {}) {
  return {
    session_id: String(session.session_id || ''),
    user_id: String(session.user_id || ''),
    refresh_token_hash: String(session.refresh_token_hash || ''),
    refresh_expires_at: toDate(session.refresh_expires_at),
    revoked_at: session.revoked_at ? toDate(session.revoked_at) : null,
    revocation_reason: session.revocation_reason || null,
    created_at: toDate(session.created_at, now()),
    updated_at: toDate(session.updated_at, now()),
    last_seen_at: toDate(session.last_seen_at, now()),
    metadata: {
      ip: session?.metadata?.ip || null,
      user_agent: session?.metadata?.user_agent || null,
    },
  };
}

function serializeSession(session = {}) {
  const normalized = normalizeSession(session);
  return {
    ...normalized,
    refresh_expires_at: normalized.refresh_expires_at.toISOString(),
    revoked_at: normalized.revoked_at ? normalized.revoked_at.toISOString() : null,
    created_at: normalized.created_at.toISOString(),
    updated_at: normalized.updated_at.toISOString(),
    last_seen_at: normalized.last_seen_at.toISOString(),
  };
}

function isSessionExpired(session = {}, reference = now()) {
  const expiresAt = toDate(session.refresh_expires_at, now());
  return expiresAt.getTime() <= reference.getTime();
}

function isSessionRevoked(session = {}) {
  return Boolean(session.revoked_at);
}

function isSessionActive(session = {}, reference = now()) {
  if (!session || !session.session_id) {
    return false;
  }
  return !isSessionRevoked(session) && !isSessionExpired(session, reference);
}

function pruneMemoryStoreIfNeeded() {
  if (memorySessionsById.size <= MEMORY_STORE_MAX_SESSIONS) {
    return;
  }

  const ordered = [...memorySessionsById.values()]
    .sort((a, b) => {
      const aSeen = toDate(a.last_seen_at, new Date(0)).getTime();
      const bSeen = toDate(b.last_seen_at, new Date(0)).getTime();
      return aSeen - bSeen;
    });

  const deleteCount = memorySessionsById.size - MEMORY_STORE_MAX_SESSIONS;
  for (let i = 0; i < deleteCount; i += 1) {
    const candidate = ordered[i];
    if (!candidate?.session_id) continue;
    memorySessionsById.delete(candidate.session_id);
    if (candidate.refresh_token_hash) {
      memorySessionIdByRefreshHash.delete(candidate.refresh_token_hash);
    }
  }
}

async function createSession({
  sessionId = randomUUID(),
  userId,
  refreshToken,
  refreshExpiresAt,
  metadata = {},
}) {
  const session = normalizeSession({
    session_id: sessionId,
    user_id: String(userId || ''),
    refresh_token_hash: hashRefreshToken(refreshToken),
    refresh_expires_at: toDate(refreshExpiresAt, new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)),
    revoked_at: null,
    revocation_reason: null,
    created_at: now(),
    updated_at: now(),
    last_seen_at: now(),
    metadata: {
      ip: metadata.ip || null,
      user_agent: metadata.user_agent || null,
    },
  });

  if (isMongoSessionReady()) {
    const persisted = await AuthSession.findOneAndUpdate(
      { session_id: session.session_id },
      { $set: session },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return serializeSession(persisted || session);
  }

  memorySessionsById.set(session.session_id, session);
  memorySessionIdByRefreshHash.set(session.refresh_token_hash, session.session_id);
  pruneMemoryStoreIfNeeded();
  return serializeSession(session);
}

async function findSessionById(sessionId) {
  const key = String(sessionId || '').trim();
  if (!key) {
    return null;
  }

  if (isMongoSessionReady()) {
    const session = await AuthSession.findOne({ session_id: key }).lean();
    return session ? serializeSession(session) : null;
  }

  const session = memorySessionsById.get(key);
  return session ? serializeSession(session) : null;
}

async function findSessionByRefreshToken(refreshToken) {
  const tokenHash = hashRefreshToken(refreshToken);
  if (!tokenHash) {
    return null;
  }

  if (isMongoSessionReady()) {
    const session = await AuthSession.findOne({ refresh_token_hash: tokenHash }).lean();
    return session ? serializeSession(session) : null;
  }

  const sessionId = memorySessionIdByRefreshHash.get(tokenHash);
  if (!sessionId) {
    return null;
  }
  const session = memorySessionsById.get(sessionId);
  return session ? serializeSession(session) : null;
}

async function touchSession(sessionId) {
  const key = String(sessionId || '').trim();
  if (!key) {
    return null;
  }

  const touchedAt = now();
  if (isMongoSessionReady()) {
    const updated = await AuthSession.findOneAndUpdate(
      { session_id: key },
      {
        $set: {
          last_seen_at: touchedAt,
          updated_at: touchedAt,
        },
      },
      { new: true }
    ).lean();
    return updated ? serializeSession(updated) : null;
  }

  const existing = memorySessionsById.get(key);
  if (!existing) {
    return null;
  }
  const updated = {
    ...existing,
    last_seen_at: touchedAt,
    updated_at: touchedAt,
  };
  memorySessionsById.set(key, updated);
  return serializeSession(updated);
}

async function rotateSessionRefreshToken({
  sessionId,
  nextRefreshToken,
  nextRefreshExpiresAt,
  metadata = {},
}) {
  const key = String(sessionId || '').trim();
  if (!key) {
    return null;
  }

  const refreshTokenHash = hashRefreshToken(nextRefreshToken);
  const updatedAt = now();
  if (isMongoSessionReady()) {
    const updated = await AuthSession.findOneAndUpdate(
      { session_id: key },
      {
        $set: {
          refresh_token_hash: refreshTokenHash,
          refresh_expires_at: toDate(nextRefreshExpiresAt, new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)),
          last_seen_at: updatedAt,
          updated_at: updatedAt,
          revoked_at: null,
          revocation_reason: null,
          metadata: {
            ip: metadata.ip || null,
            user_agent: metadata.user_agent || null,
          },
        },
      },
      { new: true }
    ).lean();
    return updated ? serializeSession(updated) : null;
  }

  const existing = memorySessionsById.get(key);
  if (!existing) {
    return null;
  }

  if (existing.refresh_token_hash) {
    memorySessionIdByRefreshHash.delete(existing.refresh_token_hash);
  }
  const updated = {
    ...existing,
    refresh_token_hash: refreshTokenHash,
    refresh_expires_at: toDate(nextRefreshExpiresAt, new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)),
    last_seen_at: updatedAt,
    updated_at: updatedAt,
    revoked_at: null,
    revocation_reason: null,
    metadata: {
      ip: metadata.ip || null,
      user_agent: metadata.user_agent || null,
    },
  };
  memorySessionsById.set(key, updated);
  memorySessionIdByRefreshHash.set(refreshTokenHash, key);
  return serializeSession(updated);
}

async function revokeSessionById(sessionId, reason = 'logout') {
  const key = String(sessionId || '').trim();
  if (!key) {
    return false;
  }
  const revokedAt = now();

  if (isMongoSessionReady()) {
    const result = await AuthSession.updateOne(
      { session_id: key, revoked_at: null },
      {
        $set: {
          revoked_at: revokedAt,
          revocation_reason: reason,
          updated_at: revokedAt,
        },
      }
    );
    return result.modifiedCount > 0;
  }

  const existing = memorySessionsById.get(key);
  if (!existing || existing.revoked_at) {
    return false;
  }
  const updated = {
    ...existing,
    revoked_at: revokedAt,
    revocation_reason: reason,
    updated_at: revokedAt,
  };
  memorySessionsById.set(key, updated);
  if (existing.refresh_token_hash) {
    memorySessionIdByRefreshHash.delete(existing.refresh_token_hash);
  }
  return true;
}

async function revokeSessionByRefreshToken(refreshToken, reason = 'logout') {
  const session = await findSessionByRefreshToken(refreshToken);
  if (!session?.session_id) {
    return false;
  }
  return revokeSessionById(session.session_id, reason);
}

async function revokeSessionsForUser(userId, reason = 'logout_all') {
  const key = String(userId || '').trim();
  if (!key) {
    return 0;
  }
  const revokedAt = now();

  if (isMongoSessionReady()) {
    const result = await AuthSession.updateMany(
      { user_id: key, revoked_at: null },
      {
        $set: {
          revoked_at: revokedAt,
          revocation_reason: reason,
          updated_at: revokedAt,
        },
      }
    );
    return Number(result.modifiedCount || 0);
  }

  let count = 0;
  [...memorySessionsById.values()].forEach((session) => {
    if (String(session.user_id) !== key || session.revoked_at) {
      return;
    }
    const updated = {
      ...session,
      revoked_at: revokedAt,
      revocation_reason: reason,
      updated_at: revokedAt,
    };
    memorySessionsById.set(session.session_id, updated);
    if (session.refresh_token_hash) {
      memorySessionIdByRefreshHash.delete(session.refresh_token_hash);
    }
    count += 1;
  });
  return count;
}

function parseDurationToSeconds(duration, fallbackSeconds) {
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    return Math.round(duration);
  }

  const text = String(duration || '').trim().toLowerCase();
  const match = text.match(/^(\d+)\s*([smhdw])$/);
  if (!match) {
    return fallbackSeconds;
  }

  const numeric = Number(match[1]);
  const unit = match[2];
  const unitSeconds = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 60 * 60 * 24,
    w: 60 * 60 * 24 * 7,
  };
  return numeric * (unitSeconds[unit] || 1);
}

function clearSessionMemoryStore() {
  memorySessionsById.clear();
  memorySessionIdByRefreshHash.clear();
}

module.exports = {
  isMongoSessionReady,
  hashRefreshToken,
  generateRefreshToken,
  isSessionActive,
  isSessionRevoked,
  isSessionExpired,
  parseDurationToSeconds,
  createSession,
  findSessionById,
  findSessionByRefreshToken,
  rotateSessionRefreshToken,
  touchSession,
  revokeSessionById,
  revokeSessionByRefreshToken,
  revokeSessionsForUser,
  __test__: {
    clearSessionMemoryStore,
  },
};
