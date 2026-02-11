const request = require('supertest');

const ORIGINAL_ENV = { ...process.env };

function loadAppWithEnv(overrides = {}) {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    ...overrides,
  };
  // eslint-disable-next-line global-require
  return require('../../app');
}

describe('Backend app middleware integration', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('allows requests from configured CORS origin', async () => {
    const app = loadAppWithEnv({
      CORS_ALLOWED_ORIGINS: 'https://allowed.example',
      CORS_ALLOW_CREDENTIALS: 'true',
      ENABLE_RATE_LIMIT: 'false',
    });

    const response = await request(app)
      .get('/')
      .set('Origin', 'https://allowed.example');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://allowed.example');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  test('blocks requests from non-allowlisted CORS origin', async () => {
    const app = loadAppWithEnv({
      CORS_ALLOWED_ORIGINS: 'https://allowed.example',
      CORS_ALLOW_CREDENTIALS: 'true',
      ENABLE_RATE_LIMIT: 'false',
    });

    const response = await request(app)
      .get('/')
      .set('Origin', 'https://blocked.example');

    expect(response.status).toBe(403);
    expect(response.body).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        message: expect.stringContaining('CORS blocked for origin'),
        status: 403,
      }),
    }));
  });

  test('enforces configured rate limit while skipping /health', async () => {
    const app = loadAppWithEnv({
      ENABLE_RATE_LIMIT: 'true',
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX_REQUESTS: '1',
      CORS_ALLOWED_ORIGINS: '',
    });

    const first = await request(app).get('/');
    expect(first.status).toBe(200);

    const second = await request(app).get('/');
    expect(second.status).toBe(429);
    expect(second.text).toContain('Too many requests');
    expect(second.headers).toEqual(expect.objectContaining({
      'ratelimit-limit': '1',
    }));

    const healthFirst = await request(app).get('/health');
    const healthSecond = await request(app).get('/health');
    expect(healthFirst.status).toBe(200);
    expect(healthSecond.status).toBe(200);
  });
});
