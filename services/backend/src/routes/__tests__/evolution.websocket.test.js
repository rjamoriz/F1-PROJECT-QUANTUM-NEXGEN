const jwt = require('jsonwebtoken');

const TEST_SECRET = 'ws-hardening-test-secret';

function resetEnv(snapshot) {
  const keys = Object.keys(process.env);
  keys.forEach((key) => {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  });
  Object.entries(snapshot).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

function loadStreamWithEnv(envOverrides = {}) {
  const snapshot = { ...process.env };

  process.env.JWT_SECRET = TEST_SECRET;
  process.env.EVOLUTION_WS_AUTH_REQUIRED = 'true';
  process.env.AUTH_REQUIRE_SESSION = 'false';
  process.env.EVOLUTION_WS_REQUIRE_SESSION = 'false';
  process.env.EVOLUTION_WS_ENFORCE_PERSISTED_ACL = 'false';
  process.env.EVOLUTION_WS_DEFAULT_ALLOWED_CARS = 'car-44';
  process.env.EVOLUTION_WS_RATE_WINDOW_MS = '60000';
  process.env.EVOLUTION_WS_MAX_MESSAGES_PER_WINDOW = '4';
  process.env.EVOLUTION_WS_MAX_SUBSCRIBE_PER_WINDOW = '2';
  process.env.EVOLUTION_WS_MAX_CARS_PER_SUBSCRIPTION = '3';

  Object.entries(envOverrides).forEach(([key, value]) => {
    process.env[key] = String(value);
  });

  jest.resetModules();
  const streamModule = require('../../services/evolutionStream');
  streamModule.__test__.resetStreamMetrics();

  return {
    streamModule,
    restore: () => resetEnv(snapshot),
  };
}

describe('Evolution websocket hardening helpers', () => {
  let restore = null;

  afterEach(() => {
    if (typeof restore === 'function') {
      restore();
    }
    restore = null;
  });

  test('authenticates JWT token from Authorization header', async () => {
    const loaded = loadStreamWithEnv();
    restore = loaded.restore;
    const { streamModule } = loaded;
    const { authenticateRequest } = streamModule.__test__;
    const token = jwt.sign(
      {
        sub: 'viewer-44',
        role: 'viewer',
        allowed_car_ids: ['car-44'],
      },
      TEST_SECRET,
      { expiresIn: '10m' }
    );

    const result = await authenticateRequest({
      headers: {
        authorization: `Bearer ${token}`,
      },
      url: '/ws/evolution',
    });

    expect(result.ok).toBe(true);
    expect(result.claims).toEqual(expect.objectContaining({
      sub: 'viewer-44',
      role: 'viewer',
    }));
    expect([...result.authorizedCars]).toEqual(['car-44']);
  });

  test('rejects missing or invalid tokens when auth is required', async () => {
    const loaded = loadStreamWithEnv();
    restore = loaded.restore;
    const { streamModule } = loaded;
    const { authenticateRequest } = streamModule.__test__;

    const missingToken = await authenticateRequest({
      headers: {},
      url: '/ws/evolution',
    });
    expect(missingToken).toEqual(expect.objectContaining({
      ok: false,
      reason: 'missing_token',
    }));

    const invalidToken = await authenticateRequest({
      headers: {
        authorization: 'Bearer malformed-token',
      },
      url: '/ws/evolution',
    });
    expect(invalidToken).toEqual(expect.objectContaining({
      ok: false,
      reason: 'invalid_token',
    }));
  });

  test('applies per-car authorization for viewer subscriptions', () => {
    const loaded = loadStreamWithEnv();
    restore = loaded.restore;
    const { streamModule } = loaded;
    const {
      applyCarAuthorization,
      normalizeRequestedCars,
      getAuthorizedCarsFromClaims,
    } = streamModule.__test__;

    const socket = {
      _auth: {
        authorizedCars: getAuthorizedCarsFromClaims({
          role: 'viewer',
          allowed_car_ids: ['car-44'],
        }),
      },
    };

    const unauthorized = applyCarAuthorization(
      socket,
      normalizeRequestedCars(['car-16'])
    );
    expect(unauthorized).toEqual(expect.objectContaining({
      ok: false,
    }));
    expect(unauthorized.reason).toContain('unauthorized_car_ids:car-16');

    const allowed = applyCarAuthorization(
      socket,
      normalizeRequestedCars(['car-44'])
    );
    expect(allowed.ok).toBe(true);
    expect([...allowed.cars]).toEqual(['car-44']);

    const emptySubscription = applyCarAuthorization(
      socket,
      normalizeRequestedCars([])
    );
    expect(emptySubscription.ok).toBe(true);
    expect([...emptySubscription.cars]).toEqual(['car-44']);
  });

  test('grants wildcard authorization to admin claims', () => {
    const loaded = loadStreamWithEnv();
    restore = loaded.restore;
    const { streamModule } = loaded;
    const { getAuthorizedCarsFromClaims, applyCarAuthorization, normalizeRequestedCars } = streamModule.__test__;

    const adminCars = getAuthorizedCarsFromClaims({
      role: 'admin',
      allowed_car_ids: ['car-44'],
    });
    expect([...adminCars]).toEqual(['*']);

    const socket = {
      _auth: {
        authorizedCars: adminCars,
      },
    };
    const requestCars = normalizeRequestedCars(['car-16', 'car-44']);
    const decision = applyCarAuthorization(socket, requestCars);
    expect(decision.ok).toBe(true);
    expect(new Set([...decision.cars])).toEqual(new Set(['car-16', 'car-44']));
  });

  test('enforces message + subscribe rate windows', () => {
    const loaded = loadStreamWithEnv({
      EVOLUTION_WS_MAX_MESSAGES_PER_WINDOW: '3',
      EVOLUTION_WS_MAX_SUBSCRIBE_PER_WINDOW: '1',
      EVOLUTION_WS_RATE_WINDOW_MS: '2000',
    });
    restore = loaded.restore;
    const { streamModule } = loaded;
    const { checkRateLimit } = streamModule.__test__;

    const socket = {};

    expect(checkRateLimit(socket, 'message').ok).toBe(true);
    expect(checkRateLimit(socket, 'subscribe').ok).toBe(true);

    const subscribeLimited = checkRateLimit(socket, 'subscribe');
    expect(subscribeLimited).toEqual(expect.objectContaining({
      ok: false,
      reason: 'subscribe_rate_limited',
    }));

    const messageLimited = checkRateLimit(socket, 'message');
    expect(messageLimited).toEqual(expect.objectContaining({
      ok: false,
      reason: 'message_rate_limited',
    }));
  });

  test('applies stricter effective limits when protection mode is elevated/strict', () => {
    const loaded = loadStreamWithEnv({
      EVOLUTION_WS_MAX_MESSAGES_PER_WINDOW: '10',
      EVOLUTION_WS_MAX_SUBSCRIBE_PER_WINDOW: '6',
      EVOLUTION_WS_MAX_CARS_PER_SUBSCRIPTION: '8',
    });
    restore = loaded.restore;
    const { streamModule } = loaded;

    const baseline = streamModule.getEvolutionStreamStatus();
    expect(baseline.protection.mode).toBe('normal');
    expect(baseline.effective_limits.max_messages_per_window).toBe(10);

    const strict = streamModule.setEvolutionStreamProtectionMode('strict', {
      source: 'test',
      reason: 'chaos_load',
    });
    expect(strict.ok).toBe(true);
    expect(strict.state.mode).toBe('strict');

    const strictStatus = streamModule.getEvolutionStreamStatus();
    expect(strictStatus.effective_limits.max_messages_per_window).toBeLessThan(10);
    expect(strictStatus.effective_limits.max_subscribe_per_window).toBeLessThan(6);
    expect(strictStatus.effective_limits.max_cars_per_subscription).toBeLessThan(8);
  });

  test('drops and closes clients when websocket backpressure threshold is exceeded', () => {
    const loaded = loadStreamWithEnv({
      EVOLUTION_WS_MAX_BUFFERED_BYTES: '8',
      EVOLUTION_WS_MAX_DROPPED_BEFORE_CLOSE: '1',
    });
    restore = loaded.restore;
    const { streamModule } = loaded;
    const { sendToClient } = streamModule.__test__;

    const socket = {
      readyState: 1,
      bufferedAmount: 64,
      send: jest.fn(),
      close: jest.fn(),
    };

    const result = sendToClient(socket, {
      type: 'telemetry_update',
      data: { car_id: 'car-44' },
    });

    expect(result).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1013, 'Backpressure');

    const status = streamModule.getEvolutionStreamStatus();
    expect(status.dropped_messages).toBeGreaterThanOrEqual(1);
  });

  test('routes telemetry delivery only to matching subscribed car/channel filters', () => {
    const loaded = loadStreamWithEnv();
    restore = loaded.restore;
    const { streamModule } = loaded;
    const { shouldDeliver } = streamModule.__test__;

    const telemetryClient = {
      _evolutionSubscription: {
        carIds: new Set(['car-44']),
        channels: new Set(['telemetry']),
      },
    };
    const twinClient = {
      _evolutionSubscription: {
        carIds: new Set(['car-44']),
        channels: new Set(['digital_twin']),
      },
    };

    expect(
      shouldDeliver(telemetryClient, 'telemetry_update', { car_id: 'car-44' })
    ).toBe(true);
    expect(
      shouldDeliver(telemetryClient, 'telemetry_update', { car_id: 'car-16' })
    ).toBe(false);
    expect(
      shouldDeliver(telemetryClient, 'digital_twin_update', { car_id: 'car-44' })
    ).toBe(false);
    expect(
      shouldDeliver(twinClient, 'digital_twin_update', { car_id: 'car-44' })
    ).toBe(true);
  });
});
