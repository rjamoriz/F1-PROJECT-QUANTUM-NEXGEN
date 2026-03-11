const http = require('http');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

const ENABLED = process.env.ENABLE_WS_E2E_TESTS === 'true';
const describeIfEnabled = ENABLED ? describe : describe.skip;

const TEST_SECRET = 'ws-e2e-secret';
const TEST_HOST = '127.0.0.1';

jest.setTimeout(30_000);

const mockUsers = [];

function mockLeanQuery(result) {
  return {
    lean: async () => result,
  };
}

jest.mock('../../../models/User', () => ({
  bulkWrite: jest.fn(async (operations) => {
    operations.forEach((operation) => {
      const filterEmail = String(operation?.updateOne?.filter?.email || '').toLowerCase();
      const payload = operation?.updateOne?.update?.$setOnInsert;
      if (!filterEmail || !payload) return;
      const existing = mockUsers.find((user) => user.email === filterEmail);
      if (!existing) {
        mockUsers.push({
          _id: `seed_${mockUsers.length + 1}`,
          ...payload,
        });
      }
    });
  }),
  findOne: jest.fn((query = {}) => {
    const email = String(query.email || '').toLowerCase();
    return mockLeanQuery(mockUsers.find((user) => user.email === email) || null);
  }),
  findById: jest.fn((id) => {
    const userId = String(id || '');
    return mockLeanQuery(mockUsers.find((user) => String(user._id) === userId) || null);
  }),
  create: jest.fn(async (payload) => {
    const user = {
      _id: `user_${mockUsers.length + 1}`,
      ...payload,
    };
    mockUsers.push(user);
    return user;
  }),
  updateOne: jest.fn(async (filter = {}, update = {}) => {
    const user = mockUsers.find((candidate) => String(candidate._id) === String(filter._id));
    if (!user) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    if (Number.isFinite(Number(update?.$inc?.token_version))) {
      user.token_version = Number(user.token_version || 0) + Number(update.$inc.token_version);
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }),
}));

function waitForMessage(socket, predicate, timeoutMs = 5000) {
  const pullQueuedMatch = () => {
    const queue = Array.isArray(socket?._queuedMessages) ? socket._queuedMessages : [];
    for (let index = 0; index < queue.length; index += 1) {
      let parsed;
      try {
        parsed = JSON.parse(String(queue[index] || '{}'));
      } catch (_error) {
        continue;
      }
      if (!predicate || predicate(parsed)) {
        queue.splice(index, 1);
        return parsed;
      }
    }
    return null;
  };

  const queued = pullQueuedMatch();
  if (queued) {
    return Promise.resolve(queued);
  }

  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for websocket message'));
    }, timeoutMs);

    const onMessage = (raw) => {
      let payload;
      try {
        payload = JSON.parse(String(raw || '{}'));
      } catch (_error) {
        return;
      }
      if (!predicate || predicate(payload)) {
        cleanup();
        resolve(payload);
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      clearTimeout(timeoutHandle);
      socket.off('message', onMessage);
      socket.off('error', onError);
    }

    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

function connectSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket._queuedMessages = [];
    socket.on('message', (raw) => {
      socket._queuedMessages.push(String(raw || '{}'));
      if (socket._queuedMessages.length > 200) {
        socket._queuedMessages.shift();
      }
    });
    const onOpen = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    function cleanup() {
      socket.off('open', onOpen);
      socket.off('error', onError);
    }
    socket.on('open', onOpen);
    socket.on('error', onError);
  });
}

function closeSocket(socket) {
  return new Promise((resolve) => {
    if (!socket || socket.readyState >= WebSocket.CLOSING) {
      resolve();
      return;
    }
    socket.once('close', () => resolve());
    socket.close();
  });
}

function waitForClose(socket, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for websocket close'));
    }, timeoutMs);
    const onClose = (code, reason) => {
      cleanup();
      resolve({
        code,
        reason: String(reason || ''),
      });
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    function cleanup() {
      clearTimeout(timeoutHandle);
      socket.off('close', onClose);
      socket.off('error', onError);
    }
    socket.on('close', onClose);
    socket.on('error', onError);
  });
}

async function waitForAuditEvents(app, query = {}, {
  attempts = 20,
  delayMs = 50,
} = {}) {
  for (let index = 0; index < attempts; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await request(app)
      .get('/api/system/observability/audit')
      .query(query);

    const events = response?.body?.data?.events || [];
    if (response.status === 200 && events.length > 0) {
      return response;
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return request(app)
    .get('/api/system/observability/audit')
    .query(query);
}

describeIfEnabled('Evolution websocket E2E lifecycle', () => {
  let app;
  let server;
  let streamModule;
  let authSessionStore;
  let auditLogStore;
  let baseUrl;
  let envSnapshot;

  beforeAll(async () => {
    envSnapshot = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.AUTH_REQUIRE_SESSION = 'true';
    process.env.EVOLUTION_WS_AUTH_REQUIRED = 'true';
    process.env.EVOLUTION_WS_REQUIRE_SESSION = 'true';
    process.env.EVOLUTION_WS_ENFORCE_PERSISTED_ACL = 'true';
    process.env.EVOLUTION_WS_DEFAULT_ALLOWED_CARS = 'car-44';
    process.env.EVOLUTION_WS_MAX_MESSAGES_PER_WINDOW = '8';
    process.env.EVOLUTION_WS_MAX_SUBSCRIBE_PER_WINDOW = '2';
    process.env.EVOLUTION_WS_RATE_WINDOW_MS = '60000';
    process.env.REQUIRE_DATABASE = 'false';
    process.env.REQUIRE_REDIS = 'false';

    jest.resetModules();
    app = require('../../../app');
    streamModule = require('../../../services/evolutionStream');
    authSessionStore = require('../../../services/authSessionStore');
    auditLogStore = require('../../../services/auditLogStore');

    server = http.createServer(app);
    streamModule.attachEvolutionWebSocketServer(server);
    await new Promise((resolve) => server.listen(0, TEST_HOST, resolve));
    const address = server.address();
    baseUrl = `ws://${TEST_HOST}:${address.port}/ws/evolution`;
  });

  afterAll(async () => {
    await streamModule.closeEvolutionWebSocketServer();
    await new Promise((resolve) => server.close(resolve));
    authSessionStore.__test__.clearSessionMemoryStore();
    auditLogStore.__test__.clearAuditMemoryStore();
    mockUsers.length = 0;

    const keys = Object.keys(process.env);
    keys.forEach((key) => {
      if (!(key in envSnapshot)) {
        delete process.env[key];
      }
    });
    Object.entries(envSnapshot).forEach(([key, value]) => {
      process.env[key] = value;
    });
  });

  beforeEach(() => {
    authSessionStore.__test__.clearSessionMemoryStore();
    auditLogStore.__test__.clearAuditMemoryStore();
    mockUsers.length = 0;
  });

  test('accepts authenticated session token and streams telemetry over active websocket', async () => {
    const email = `ws_e2e_${Date.now()}@qaero.dev`;
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'WS E2E User',
        email,
        password: 'e2epass123',
        role: 'engineer',
        allowed_car_ids: ['car-44'],
      });
    expect(registerResponse.status).toBe(201);

    const socket = await connectSocket(`${baseUrl}?token=${encodeURIComponent(registerResponse.body.access_token)}`);
    const connectedPayload = await waitForMessage(socket, (message) => message.type === 'connected', 10_000);
    expect(connectedPayload.data).toEqual(expect.objectContaining({
      role: 'engineer',
      user_id: registerResponse.body.user.id,
      session_id: registerResponse.body.session_id,
    }));
    expect(connectedPayload.data.car_ids).toContain('car-44');

    socket.send(JSON.stringify({
      command: 'subscribe',
      car_id: 'car-44',
      channels: ['telemetry'],
    }));
    const subscribedPayload = await waitForMessage(socket, (message) => message.type === 'subscribed', 10_000);
    expect(subscribedPayload.data.car_ids).toEqual(['car-44']);
    expect(subscribedPayload.data.channels).toEqual(['telemetry']);

    streamModule.publishEvolutionEvent(
      'telemetry_update',
      {
        car_id: 'car-44',
        point: {
          telemetry_id: 'e2e-telemetry-1',
          speed_kph: 322.4,
        },
      },
      { car_id: 'car-44' }
    );
    const telemetryPayload = await waitForMessage(socket, (message) => message.type === 'telemetry_update', 10_000);
    expect(telemetryPayload.data).toEqual(expect.objectContaining({
      car_id: 'car-44',
      point: expect.objectContaining({
        telemetry_id: 'e2e-telemetry-1',
      }),
    }));

    await closeSocket(socket);
  }, 20_000);

  test('enforces persisted per-car ACL even when token claim is forged with broader car access', async () => {
    const email = `ws_acl_${Date.now()}@qaero.dev`;
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'WS ACL User',
        email,
        password: 'aclpass123',
        role: 'engineer',
        allowed_car_ids: ['car-44'],
      });
    expect(registerResponse.status).toBe(201);

    const decoded = jwt.verify(registerResponse.body.access_token, TEST_SECRET);
    const forgedToken = jwt.sign(
      {
        sub: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        tv: decoded.tv,
        sid: decoded.sid,
        allowed_car_ids: ['car-16', 'car-44'],
        jti: 'forged-jti',
      },
      TEST_SECRET,
      { expiresIn: '10m' }
    );

    const socket = await connectSocket(`${baseUrl}?token=${encodeURIComponent(forgedToken)}`);
    const connectedPayload = await waitForMessage(socket, (message) => message.type === 'connected', 10_000);
    expect(connectedPayload.data.car_ids).toEqual(['car-44']);

    socket.send(JSON.stringify({
      command: 'subscribe',
      car_id: 'car-16',
      channels: ['telemetry'],
    }));
    const forbiddenPayload = await waitForMessage(
      socket,
      (message) => message.type === 'stream_error' && message?.data?.code === 'FORBIDDEN',
      10_000
    );
    expect(forbiddenPayload.data.message).toContain('unauthorized_car_ids:car-16');

    await closeSocket(socket);
  }, 20_000);

  test('rejects websocket connection for revoked sessions', async () => {
    const email = `ws_revoke_${Date.now()}@qaero.dev`;
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'WS Revoke User',
        email,
        password: 'revokepass123',
        role: 'engineer',
        allowed_car_ids: ['car-44'],
      });
    expect(registerResponse.status).toBe(201);

    const logoutResponse = await request(app)
      .post('/api/auth/logout')
      .send({
        refresh_token: registerResponse.body.refresh_token,
      });
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body.revoked_sessions).toBeGreaterThan(0);

    const socket = await connectSocket(`${baseUrl}?token=${encodeURIComponent(registerResponse.body.access_token)}`);
    const closeEvent = await waitForClose(socket);
    expect(closeEvent.code).toBe(4401);

    const streamStatus = streamModule.getEvolutionStreamStatus();
    expect(streamStatus.auth_failures).toBeGreaterThanOrEqual(1);
    expect(streamStatus.rejected_connections).toBeGreaterThanOrEqual(1);
  }, 15_000);

  test('records websocket connection_denied audit events for missing tokens', async () => {
    const socket = await connectSocket(baseUrl);
    const closeEvent = await waitForClose(socket);
    expect(closeEvent.code).toBe(4401);

    const auditResponse = await waitForAuditEvents(app, {
      action: 'evolution.ws.connection_denied',
      since_minutes: 30,
      limit: 10,
    });
    expect(auditResponse.status).toBe(200);
    const firstEvent = auditResponse.body.data.events[0];
    expect(firstEvent).toEqual(expect.objectContaining({
      action: 'evolution.ws.connection_denied',
      source: 'ws',
      outcome: 'denied',
      reason: 'missing_token',
      method: 'WS_CONNECT',
    }));
  }, 15_000);

  test('records websocket acl_denied audit events for unauthorized subscriptions', async () => {
    const email = `ws_audit_acl_${Date.now()}@qaero.dev`;
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'WS ACL Audit User',
        email,
        password: 'aclpass123',
        role: 'engineer',
        allowed_car_ids: ['car-44'],
      });
    expect(registerResponse.status).toBe(201);

    const socket = await connectSocket(`${baseUrl}?token=${encodeURIComponent(registerResponse.body.access_token)}`);
    await waitForMessage(socket, (message) => message.type === 'connected', 10_000);

    socket.send(JSON.stringify({
      command: 'subscribe',
      car_id: 'car-16',
      channels: ['telemetry'],
    }));
    const forbiddenPayload = await waitForMessage(
      socket,
      (message) => message.type === 'stream_error' && message?.data?.code === 'FORBIDDEN',
      10_000
    );
    expect(forbiddenPayload.data.message).toContain('unauthorized_car_ids:car-16');
    await closeSocket(socket);

    const auditResponse = await waitForAuditEvents(app, {
      action: 'evolution.ws.acl_denied',
      actor_user_id: registerResponse.body.user.id,
      since_minutes: 30,
      limit: 10,
    });
    expect(auditResponse.status).toBe(200);
    const firstEvent = auditResponse.body.data.events[0];
    expect(firstEvent).toEqual(expect.objectContaining({
      action: 'evolution.ws.acl_denied',
      source: 'ws',
      outcome: 'denied',
      actor_user_id: registerResponse.body.user.id,
      method: 'WS_SUBSCRIBE',
    }));
    expect(Array.isArray(firstEvent.car_ids)).toBe(true);
    expect(firstEvent.car_ids).toContain('car-16');
  }, 20_000);

  test('enforces live message rate limits and emits RATE_LIMITED stream errors', async () => {
    const email = `ws_rate_${Date.now()}@qaero.dev`;
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'WS Rate User',
        email,
        password: 'ratepass123',
        role: 'engineer',
        allowed_car_ids: ['car-44'],
      });
    expect(registerResponse.status).toBe(201);

    const socket = await connectSocket(`${baseUrl}?token=${encodeURIComponent(registerResponse.body.access_token)}`);
    await waitForMessage(socket, (message) => message.type === 'connected', 10_000);

    for (let index = 0; index < 10; index += 1) {
      socket.send(JSON.stringify({ command: 'ping' }));
    }

    const limitedPayload = await waitForMessage(
      socket,
      (message) => message.type === 'stream_error' && message?.data?.code === 'RATE_LIMITED',
      10_000
    );
    expect(limitedPayload.data.message).toBe('message_rate_limited');

    await closeSocket(socket);

    const streamStatus = streamModule.getEvolutionStreamStatus();
    expect(streamStatus.rate_limited_messages).toBeGreaterThanOrEqual(1);
  }, 20_000);

  test('enforces live subscribe churn limits and emits subscribe_rate_limited', async () => {
    const email = `ws_subrate_${Date.now()}@qaero.dev`;
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'WS Subscribe Rate User',
        email,
        password: 'subratepass123',
        role: 'engineer',
        allowed_car_ids: ['car-44'],
      });
    expect(registerResponse.status).toBe(201);

    const socket = await connectSocket(`${baseUrl}?token=${encodeURIComponent(registerResponse.body.access_token)}`);
    await waitForMessage(socket, (message) => message.type === 'connected', 10_000);

    socket.send(JSON.stringify({ command: 'subscribe', car_id: 'car-44', channels: ['telemetry'] }));
    await waitForMessage(socket, (message) => message.type === 'subscribed', 10_000);

    socket.send(JSON.stringify({ command: 'subscribe', car_id: 'car-44', channels: ['digital_twin'] }));
    await waitForMessage(socket, (message) => message.type === 'subscribed', 10_000);

    socket.send(JSON.stringify({ command: 'subscribe', car_id: 'car-44', channels: ['telemetry', 'digital_twin'] }));
    const limitedPayload = await waitForMessage(
      socket,
      (message) => message.type === 'stream_error' && message?.data?.code === 'RATE_LIMITED',
      10_000
    );
    expect(limitedPayload.data.message).toBe('subscribe_rate_limited');

    await closeSocket(socket);
  }, 20_000);

  test('handles reconnect storm cycles without leaking websocket clients', async () => {
    const email = `ws_storm_${Date.now()}@qaero.dev`;
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'WS Storm User',
        email,
        password: 'stormpass123',
        role: 'engineer',
        allowed_car_ids: ['car-44'],
      });
    expect(registerResponse.status).toBe(201);

    const waveSize = 6;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      // eslint-disable-next-line no-await-in-loop
      const sockets = await Promise.all(
        Array.from({ length: waveSize }).map(() => (
          connectSocket(`${baseUrl}?token=${encodeURIComponent(registerResponse.body.access_token)}`)
        ))
      );

      // eslint-disable-next-line no-await-in-loop
      await Promise.all(sockets.map((socket) => (
        waitForMessage(socket, (message) => message.type === 'connected', 10_000)
      )));

      streamModule.publishEvolutionEvent(
        'telemetry_update',
        {
          car_id: 'car-44',
          point: {
            telemetry_id: `storm-${cycle + 1}`,
            speed_kph: 318.2 + cycle,
          },
        },
        { car_id: 'car-44' }
      );

      // eslint-disable-next-line no-await-in-loop
      await Promise.all(sockets.slice(0, 2).map((socket) => (
        waitForMessage(socket, (message) => message.type === 'telemetry_update', 10_000)
      )));

      // eslint-disable-next-line no-await-in-loop
      await Promise.all(sockets.map((socket) => closeSocket(socket)));
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));
      // eslint-disable-next-line no-await-in-loop
      const streamStatus = streamModule.getEvolutionStreamStatus();
      expect(streamStatus.connected_clients).toBe(0);
    }
  }, 30_000);
});
