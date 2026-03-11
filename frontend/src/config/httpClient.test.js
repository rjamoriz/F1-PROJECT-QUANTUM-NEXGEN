const mockAxios = {
  defaults: {
    headers: {
      common: {},
    },
    timeout: 0,
  },
  interceptors: {
    request: {
      use: jest.fn(),
    },
    response: {
      use: jest.fn(),
    },
  },
  post: jest.fn(),
  request: jest.fn(),
};

jest.mock('axios', () => mockAxios);

describe('httpClient auth lifecycle', () => {
  let requestInterceptor = null;
  let responseErrorInterceptor = null;
  let envSnapshot;

  beforeEach(() => {
    envSnapshot = { ...process.env };
    process.env.REACT_APP_HTTP_TIMEOUT_MS = '30000';
    process.env.REACT_APP_AUTH_AUTO_REFRESH = 'true';
    delete process.env.REACT_APP_BACKEND_URL;

    jest.resetModules();
    jest.clearAllMocks();

    requestInterceptor = null;
    responseErrorInterceptor = null;
    mockAxios.defaults.headers.common = {};
    mockAxios.defaults.timeout = 0;
    mockAxios.interceptors.request.use.mockImplementation((handler) => {
      requestInterceptor = handler;
      return 1;
    });
    mockAxios.interceptors.response.use.mockImplementation((_successHandler, errorHandler) => {
      responseErrorInterceptor = errorHandler;
      return 2;
    });

    localStorage.clear();
  });

  afterEach(() => {
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

  test('persists and clears auth bundle using shared storage contract', () => {
    const {
      persistAuthBundle,
      readStoredAuth,
      clearStoredAuth,
      AUTH_EVENTS,
    } = require('./httpClient');

    const updatedEvents = [];
    const revokedEvents = [];
    window.addEventListener(AUTH_EVENTS.sessionUpdated, (event) => {
      updatedEvents.push(event.detail);
    });
    window.addEventListener(AUTH_EVENTS.sessionRevoked, (event) => {
      revokedEvents.push(event.detail);
    });

    const persisted = persistAuthBundle({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      session_id: 'session-1',
    });
    expect(persisted).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      sessionId: 'session-1',
    });
    expect(readStoredAuth()).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      sessionId: 'session-1',
    });
    expect(mockAxios.defaults.headers.common.Authorization).toBe('Bearer access-1');
    expect(updatedEvents[0]).toEqual(expect.objectContaining({
      access_token: 'access-1',
      refresh_token_present: true,
      session_id: 'session-1',
    }));

    clearStoredAuth('token_revoked');
    expect(readStoredAuth()).toEqual({
      accessToken: '',
      refreshToken: '',
      sessionId: '',
    });
    expect(mockAxios.defaults.headers.common.Authorization).toBeUndefined();
    expect(revokedEvents[0]).toEqual({
      reason: 'token_revoked',
    });
  });

  test('configures request interceptor for URL rewrite + auth header injection', () => {
    process.env.REACT_APP_BACKEND_URL = 'https://api.qaero.example';
    localStorage.setItem('auth_token', 'access-live');

    const { configureHttpClient } = require('./httpClient');
    configureHttpClient();

    expect(typeof requestInterceptor).toBe('function');
    expect(mockAxios.defaults.timeout).toBe(30000);

    const rewrittenRelative = requestInterceptor({
      url: '/api/system/health',
      headers: {},
    });
    expect(rewrittenRelative.url).toBe('https://api.qaero.example/api/system/health');
    expect(rewrittenRelative.headers.Authorization).toBe('Bearer access-live');

    const rewrittenAbsolute = requestInterceptor({
      url: 'http://localhost:3001/api/system/health',
      headers: {},
    });
    expect(rewrittenAbsolute.url).toBe('https://api.qaero.example/api/system/health');
  });

  test('refreshes session token on 401 and retries original request once', async () => {
    localStorage.setItem('auth_token', 'stale-access');
    localStorage.setItem('refresh_token', 'refresh-1');

    const { configureHttpClient } = require('./httpClient');
    configureHttpClient();

    mockAxios.post.mockResolvedValue({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        session_id: 'session-2',
      },
    });
    mockAxios.request.mockResolvedValue({
      data: { ok: true },
      status: 200,
    });

    const unauthorizedError = {
      response: {
        status: 401,
        data: {
          reason: 'expired_token',
        },
      },
      config: {
        url: '/api/evolution/production/telemetry/recent',
        method: 'get',
        headers: {},
      },
    };

    const response = await responseErrorInterceptor(unauthorizedError);
    expect(response).toEqual({
      data: { ok: true },
      status: 200,
    });

    expect(mockAxios.post).toHaveBeenCalledWith(
      'http://localhost:3001/api/auth/refresh',
      { refresh_token: 'refresh-1' },
      { __skipAuthRefresh: true }
    );
    expect(mockAxios.request).toHaveBeenCalledTimes(1);
    const retryConfig = mockAxios.request.mock.calls[0][0];
    expect(retryConfig.__authRetryAttempted).toBe(true);
    expect(retryConfig.headers.Authorization).toBe('Bearer new-access');
    expect(localStorage.getItem('auth_token')).toBe('new-access');
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh');
  });

  test('uses single-flight refresh for concurrent 401 responses', async () => {
    localStorage.setItem('auth_token', 'stale-access');
    localStorage.setItem('refresh_token', 'refresh-1');

    const { configureHttpClient } = require('./httpClient');
    configureHttpClient();

    let resolveRefresh;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    mockAxios.post.mockImplementation(() => refreshPromise);
    mockAxios.request.mockResolvedValue({ data: { ok: true } });

    const baseError = {
      response: { status: 401, data: { reason: 'expired_token' } },
      config: {
        url: '/api/evolution/production/digital-twin/state',
        method: 'get',
        headers: {},
      },
    };

    const callA = responseErrorInterceptor({
      ...baseError,
      config: { ...baseError.config, params: { car_id: 'car-44' } },
    });
    const callB = responseErrorInterceptor({
      ...baseError,
      config: { ...baseError.config, params: { car_id: 'car-16' } },
    });

    expect(mockAxios.post).toHaveBeenCalledTimes(1);

    resolveRefresh({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        session_id: 'session-3',
      },
    });
    await Promise.all([callA, callB]);

    expect(mockAxios.request).toHaveBeenCalledTimes(2);
  });

  test('forces local logout on revocation reason without refresh attempt', async () => {
    localStorage.setItem('auth_token', 'access-1');
    localStorage.setItem('refresh_token', 'refresh-1');
    localStorage.setItem('auth_session_id', 'session-1');

    const {
      configureHttpClient,
      AUTH_EVENTS,
    } = require('./httpClient');
    configureHttpClient();

    const revocationEvents = [];
    window.addEventListener(AUTH_EVENTS.sessionRevoked, (event) => {
      revocationEvents.push(event.detail);
    });

    const revokedError = {
      response: {
        status: 401,
        data: {
          reason: 'token_revoked',
        },
      },
      config: {
        url: '/api/evolution/production/telemetry/recent',
        method: 'get',
        headers: {},
      },
    };

    await expect(responseErrorInterceptor(revokedError)).rejects.toBe(revokedError);
    expect(mockAxios.post).not.toHaveBeenCalled();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(revocationEvents[0]).toEqual({
      reason: 'token_revoked',
    });
  });

  test('can disable auto refresh interceptor through env', () => {
    process.env.REACT_APP_AUTH_AUTO_REFRESH = 'false';

    const { configureHttpClient } = require('./httpClient');
    configureHttpClient();

    expect(mockAxios.interceptors.request.use).toHaveBeenCalledTimes(1);
    expect(mockAxios.interceptors.response.use).not.toHaveBeenCalled();
  });
});
