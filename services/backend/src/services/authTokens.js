const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const {
  createSession,
  generateRefreshToken,
  findSessionById,
  findSessionByRefreshToken,
  rotateSessionRefreshToken,
  revokeSessionById,
  revokeSessionByRefreshToken,
  revokeSessionsForUser,
  isSessionActive,
  parseDurationToSeconds,
  touchSession,
} = require('./authSessionStore');

const JWT_SECRET = process.env.JWT_SECRET || 'qaero-local-dev-secret';
const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const AUTH_REQUIRE_SESSION = String(process.env.AUTH_REQUIRE_SESSION || 'true').toLowerCase() !== 'false';
const DEFAULT_ALLOWED_CARS = String(process.env.DEFAULT_ALLOWED_CARS || 'car-44')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function toObjectIdString(value) {
  return String(value || '').trim();
}

function normalizeCarIds(raw) {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(',').map((value) => value.trim()).filter(Boolean);
  }
  if (raw && typeof raw === 'object') {
    return Object.values(raw).map((value) => String(value || '').trim()).filter(Boolean);
  }
  if (raw) {
    return [String(raw).trim()].filter(Boolean);
  }
  return [];
}

function resolveAllowedCars(userLike = {}) {
  const role = String(userLike.role || '').toLowerCase();
  if (role === 'admin') {
    return ['*'];
  }

  const fromUser = normalizeCarIds(userLike.allowed_car_ids);
  if (fromUser.length > 0) {
    return fromUser;
  }
  return DEFAULT_ALLOWED_CARS.length > 0 ? DEFAULT_ALLOWED_CARS : ['car-44'];
}

function buildAccessTokenPayload(user, sessionId) {
  return {
    sub: toObjectIdString(user._id || user.id),
    email: String(user.email || '').toLowerCase(),
    role: String(user.role || 'viewer').toLowerCase(),
    allowed_car_ids: resolveAllowedCars(user),
    tv: Number.isFinite(Number(user.token_version)) ? Number(user.token_version) : 0,
    sid: String(sessionId || ''),
    jti: randomUUID(),
  };
}

function issueAccessToken(user, sessionId) {
  const payload = buildAccessTokenPayload(user, sessionId);
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
}

function parseBearerToken(req = {}) {
  const authHeader = String(req?.headers?.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return authHeader.slice('bearer '.length).trim() || null;
}

function buildAuthTokenResponse({
  user,
  accessToken,
  refreshToken,
  sessionId,
}) {
  const expiresIn = parseDurationToSeconds(ACCESS_TOKEN_EXPIRES_IN, 60 * 60 * 24);
  const refreshExpiresIn = parseDurationToSeconds(REFRESH_TOKEN_EXPIRES_IN, 60 * 60 * 24 * 30);

  return {
    token: accessToken, // Backward-compatible alias
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    refresh_expires_in: refreshExpiresIn,
    session_id: sessionId,
    user: {
      id: toObjectIdString(user._id || user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      allowed_car_ids: resolveAllowedCars(user),
      token_version: Number.isFinite(Number(user.token_version)) ? Number(user.token_version) : 0,
      created_at: user.created_at instanceof Date
        ? user.created_at.toISOString()
        : user.created_at,
    },
  };
}

function calculateRefreshExpiryDate(reference = Date.now()) {
  const seconds = parseDurationToSeconds(REFRESH_TOKEN_EXPIRES_IN, 60 * 60 * 24 * 30);
  return new Date(reference + seconds * 1000);
}

function isDatabaseReady() {
  if (mongoose?.connection?.readyState === 1) {
    return true;
  }
  if (process.env.NODE_ENV === 'test') {
    const mockedUserModel = Boolean(
      User?.findById?._isMockFunction
      || User?.findOne?._isMockFunction
      || User?.updateOne?._isMockFunction
    );
    return mockedUserModel;
  }
  return false;
}

async function resolveUserForTokenClaims(claims = {}) {
  if (!isDatabaseReady()) {
    return null;
  }

  if (claims?.sub) {
    const userById = await User.findById(claims.sub).lean();
    if (userById) {
      return userById;
    }
  }
  if (claims?.email) {
    return User.findOne({ email: String(claims.email).toLowerCase() }).lean();
  }
  return null;
}

async function issueAuthSession(user, metadata = {}) {
  const refreshToken = generateRefreshToken();
  const refreshExpiresAt = calculateRefreshExpiryDate();
  const createdSession = await createSession({
    userId: toObjectIdString(user._id || user.id),
    refreshToken,
    refreshExpiresAt,
    metadata,
  });

  const accessToken = issueAccessToken(user, createdSession.session_id);
  return buildAuthTokenResponse({
    user,
    accessToken,
    refreshToken,
    sessionId: createdSession.session_id,
  });
}

async function refreshAuthSession(refreshToken, metadata = {}) {
  const session = await findSessionByRefreshToken(refreshToken);
  if (!session || !isSessionActive(session)) {
    return {
      ok: false,
      reason: 'invalid_refresh_token',
    };
  }

  const user = await resolveUserForTokenClaims({
    sub: session.user_id,
  });
  if (!user) {
    await revokeSessionById(session.session_id, 'user_not_found');
    return {
      ok: false,
      reason: 'user_not_found',
    };
  }

  const nextRefreshToken = generateRefreshToken();
  const nextRefreshExpiresAt = calculateRefreshExpiryDate();
  const rotated = await rotateSessionRefreshToken({
    sessionId: session.session_id,
    nextRefreshToken,
    nextRefreshExpiresAt,
    metadata,
  });
  if (!rotated) {
    return {
      ok: false,
      reason: 'session_rotation_failed',
    };
  }

  const nextAccessToken = issueAccessToken(user, session.session_id);
  return {
    ok: true,
    bundle: buildAuthTokenResponse({
      user,
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken,
      sessionId: session.session_id,
    }),
  };
}

async function verifyAccessToken(token, options = {}) {
  const requireSession = options.requireSession ?? AUTH_REQUIRE_SESSION;
  const requirePersistedUser = options.requirePersistedUser ?? false;
  const failOnPersistenceUnavailable = options.failOnPersistenceUnavailable ?? false;

  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return {
      ok: false,
      reason: 'invalid_token',
    };
  }

  const dbReady = isDatabaseReady();
  if (!dbReady && requirePersistedUser && failOnPersistenceUnavailable) {
    return {
      ok: false,
      reason: 'persistence_unavailable',
    };
  }

  const user = await resolveUserForTokenClaims(claims);
  if (!user && requirePersistedUser && dbReady) {
    return {
      ok: false,
      reason: 'user_not_found',
    };
  }

  if (user) {
    const tokenVersion = Number.isFinite(Number(claims.tv)) ? Number(claims.tv) : 0;
    const userTokenVersion = Number.isFinite(Number(user.token_version)) ? Number(user.token_version) : 0;
    if (tokenVersion !== userTokenVersion) {
      return {
        ok: false,
        reason: 'token_revoked',
      };
    }
  }

  let session = null;
  if (claims.sid) {
    session = await findSessionById(claims.sid);
    if (!session || !isSessionActive(session)) {
      return {
        ok: false,
        reason: 'session_revoked',
      };
    }

    if (user && String(session.user_id) !== toObjectIdString(user._id || user.id)) {
      return {
        ok: false,
        reason: 'session_user_mismatch',
      };
    }
    await touchSession(session.session_id);
  } else if (requireSession) {
    return {
      ok: false,
      reason: 'missing_session',
    };
  }

  const effectiveRole = String(user?.role || claims?.role || 'viewer').toLowerCase();
  const effectiveAllowedCars = resolveAllowedCars(user || claims);
  return {
    ok: true,
    claims,
    user,
    role: effectiveRole,
    allowed_car_ids: effectiveAllowedCars,
    session,
  };
}

async function revokeByRefreshToken(refreshToken, reason = 'logout') {
  const revoked = await revokeSessionByRefreshToken(refreshToken, reason);
  return revoked;
}

async function revokeBySessionId(sessionId, reason = 'logout') {
  return revokeSessionById(sessionId, reason);
}

async function revokeAllUserAccess(userId) {
  const revokedSessions = await revokeSessionsForUser(userId, 'logout_all');
  if (isDatabaseReady()) {
    await User.updateOne(
      { _id: userId },
      {
        $inc: { token_version: 1 },
      }
    );
  }
  return revokedSessions;
}

module.exports = {
  parseBearerToken,
  resolveAllowedCars,
  issueAccessToken,
  issueAuthSession,
  refreshAuthSession,
  verifyAccessToken,
  revokeByRefreshToken,
  revokeBySessionId,
  revokeAllUserAccess,
  __test__: {
    buildAccessTokenPayload,
  },
};
