import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';

jest.mock('recharts', () => {
  const ReactRef = require('react');
  const Container = ({ children }) => ReactRef.createElement('div', null, children);
  const Empty = () => null;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    Line: Empty,
    CartesianGrid: Empty,
    XAxis: Empty,
    YAxis: Empty,
    Tooltip: Empty,
    Legend: Empty,
  };
});

const requestHandlers = [];
const responseSuccessHandlers = [];
const responseErrorHandlers = [];
let handler = async () => ({ status: 200, data: {} });

function mergeHeaders(config = {}, defaults = {}) {
  return {
    ...(defaults || {}),
    ...(config.headers || {}),
  };
}

async function applyRequestInterceptors(config = {}, mock) {
  let next = {
    ...config,
    headers: mergeHeaders(config, mock.defaults.headers.common),
  };
  for (const requestHandler of requestHandlers) {
    if (typeof requestHandler !== 'function') continue;
    const result = await requestHandler(next);
    if (result) {
      next = result;
    }
  }
  return next;
}

async function dispatch(config = {}, mock) {
  const resolvedConfig = await applyRequestInterceptors(config, mock);
  try {
    const response = await handler(resolvedConfig);
    let nextResponse = {
      status: 200,
      ...response,
      config: resolvedConfig,
    };
    for (const successHandler of responseSuccessHandlers) {
      if (typeof successHandler !== 'function') continue;
      const transformed = await successHandler(nextResponse);
      if (transformed) {
        nextResponse = transformed;
      }
    }
    return nextResponse;
  } catch (rawError) {
    let nextError = rawError;
    nextError.config = nextError.config || resolvedConfig;
    for (const errorHandler of responseErrorHandlers) {
      if (typeof errorHandler !== 'function') continue;
      try {
        return await errorHandler(nextError);
      } catch (forwardedError) {
        nextError = forwardedError;
      }
    }
    throw nextError;
  }
}

const mockAxios = {
  defaults: {
    headers: {
      common: {},
    },
    timeout: 0,
  },
  interceptors: {
    request: {
      use: jest.fn((handlerFn) => {
        requestHandlers.push(handlerFn);
        return requestHandlers.length;
      }),
    },
    response: {
      use: jest.fn((successFn, errorFn) => {
        responseSuccessHandlers.push(successFn);
        responseErrorHandlers.push(errorFn);
        return responseErrorHandlers.length;
      }),
    },
  },
  get: jest.fn(),
  post: jest.fn(),
  request: jest.fn(),
  __setHandler: (nextHandler) => {
    handler = nextHandler;
  },
  __reset: () => {
    handler = async () => ({ status: 200, data: {} });
    bindTransportMocks();
    mockAxios.get.mockClear();
    mockAxios.post.mockClear();
    mockAxios.request.mockClear();
    delete mockAxios.defaults.headers.common.Authorization;
  },
};

function bindTransportMocks() {
  mockAxios.get.mockImplementation((url, config = {}) => dispatch({ ...config, method: 'get', url }, mockAxios));
  mockAxios.post.mockImplementation((url, data = {}, config = {}) => dispatch({
    ...config,
    method: 'post',
    url,
    data,
  }, mockAxios));
  mockAxios.request.mockImplementation((config = {}) => dispatch(config, mockAxios));
}

bindTransportMocks();

jest.mock('axios', () => mockAxios);

const axios = require('axios');
const { configureHttpClient } = require('../config/httpClient');
const ProductionTwinDashboard = require('./ProductionTwinDashboard').default;

function resolvePath(url) {
  const text = String(url || '').trim();
  if (!text) return '/';
  if (text.startsWith('http://') || text.startsWith('https://')) {
    try {
      return new URL(text).pathname;
    } catch (_error) {
      return text;
    }
  }
  if (text.startsWith('/')) return text;
  return `/${text}`;
}

function unauthorizedError(config, reason = 'expired_token') {
  const error = new Error('Unauthorized');
  error.response = {
    status: 401,
    data: { reason },
  };
  error.config = config;
  return error;
}

describe('ProductionTwinDashboard protected-route auth recovery', () => {
  let OriginalWebSocket;
  let container;
  let root;

  async function waitForCondition(assertion, timeoutMs = 4000) {
    const startedAt = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        assertion();
        return;
      } catch (error) {
        if (Date.now() - startedAt > timeoutMs) {
          throw error;
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  }

  beforeAll(() => {
    process.env.REACT_APP_AUTH_AUTO_REFRESH = 'true';
    global.IS_REACT_ACT_ENVIRONMENT = true;
    OriginalWebSocket = global.WebSocket;
    global.WebSocket = class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        this.bufferedAmount = 0;
        setTimeout(() => {
          if (typeof this.onopen === 'function') {
            this.onopen();
          }
        }, 0);
      }
      send() {}
      close() {
        this.readyState = 3;
        if (typeof this.onclose === 'function') {
          this.onclose();
        }
      }
    };
    configureHttpClient();
    expect(axios.interceptors.request.use).toHaveBeenCalled();
    expect(axios.interceptors.response.use).toHaveBeenCalled();
  });

  beforeEach(() => {
    bindTransportMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterAll(() => {
    delete global.IS_REACT_ACT_ENVIRONMENT;
    global.WebSocket = OriginalWebSocket;
  });

  afterEach(() => {
    act(() => {
      if (root) {
        root.unmount();
      }
    });
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
    root = null;
    localStorage.clear();
    axios.__reset();
  });

  test('dashboard recovers initial protected data load via single refresh rotation', async () => {
    localStorage.setItem('auth_token', 'stale-token');
    localStorage.setItem('refresh_token', 'refresh-token-1');

    const stats = {
      refreshCalls: 0,
      protectedCalls: 0,
      paths: [],
    };

    axios.__setHandler(async (config = {}) => {
      const path = resolvePath(config.url);
      stats.paths.push(path);
      const authHeader = String(config?.headers?.Authorization || '');

      if (path.endsWith('/api/auth/refresh')) {
        stats.refreshCalls += 1;
        return {
          status: 200,
          data: {
            access_token: 'fresh-token',
            refresh_token: 'refresh-token-2',
            session_id: 'session-2',
          },
        };
      }

      if (path.startsWith('/api/evolution/production/')) {
        stats.protectedCalls += 1;
        if (authHeader !== 'Bearer fresh-token') {
          throw unauthorizedError(config);
        }
      }

      if (path.endsWith('/api/evolution/production/telemetry/recent')) {
        return {
          status: 200,
          data: {
            success: true,
            data: {
              car_id: 'car-44',
              total_points: 2,
              points: [
                { telemetry_id: 'p1', car_id: 'car-44', timestamp: new Date().toISOString(), speed_kph: 300, downforce_n: 4400, drag_n: 1300 },
                { telemetry_id: 'p2', car_id: 'car-44', timestamp: new Date().toISOString(), speed_kph: 310, downforce_n: 4500, drag_n: 1290 },
              ],
              summary: {
                count: 2,
                avg_speed_kph: 305.1,
                avg_downforce_n: 4450,
                avg_drag_n: 1295,
                avg_efficiency: 3.4363,
              },
            },
          },
        };
      }

      if (path.endsWith('/api/evolution/production/digital-twin/state')) {
        return {
          status: 200,
          data: {
            success: true,
            data: {
              twin_id: 'twin-car-44',
              recommendations: { drs_open: true, flap_angle_deg: 6.2 },
            },
          },
        };
      }

      if (path.endsWith('/api/evolution/production/telemetry/summary')) {
        return {
          status: 200,
          data: {
            success: true,
            data: {
              fleet_summary: { cars_monitored: 1, total_window_points: 2 },
              cars: [],
            },
          },
        };
      }

      if (path.endsWith('/api/evolution/production/stream/status')) {
        return {
          status: 200,
          data: {
            success: true,
            data: {
              connected_clients: 1,
            },
          },
        };
      }

      return {
        status: 200,
        data: {},
      };
    });

    await act(async () => {
      root.render(<ProductionTwinDashboard />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitForCondition(() => {
      expect(axios.get.mock.calls.length).toBeGreaterThan(0);
    });
    await waitForCondition(() => {
      expect(stats.paths.length).toBeGreaterThan(0);
    });
    expect(stats.paths).toEqual(expect.arrayContaining([
      '/api/evolution/production/telemetry/recent',
      '/api/evolution/production/digital-twin/state',
      '/api/evolution/production/telemetry/summary',
      '/api/evolution/production/stream/status',
    ]));
    await waitForCondition(() => {
      expect(stats.refreshCalls).toBe(1);
    });
    await waitForCondition(() => {
      expect(localStorage.getItem('auth_token')).toBe('fresh-token');
    });
    await waitForCondition(() => {
      expect(container.textContent).toContain('305.10 kph');
    });
    expect(stats.protectedCalls).toBeGreaterThanOrEqual(4);
  });

  test('dashboard manual refresh also recovers transparently after token expiry', async () => {
    localStorage.setItem('auth_token', 'stale-token');
    localStorage.setItem('refresh_token', 'refresh-token-1');

    const stats = {
      refreshCalls: 0,
      activeAccessToken: 'fresh-token-1',
    };

    axios.__setHandler(async (config = {}) => {
      const path = resolvePath(config.url);
      const authHeader = String(config?.headers?.Authorization || '');

      if (path.endsWith('/api/auth/refresh')) {
        stats.refreshCalls += 1;
        stats.activeAccessToken = `fresh-token-${stats.refreshCalls}`;
        return {
          status: 200,
          data: {
            access_token: stats.activeAccessToken,
            refresh_token: `refresh-token-${stats.refreshCalls + 1}`,
            session_id: `session-${stats.refreshCalls + 1}`,
          },
        };
      }

      if (path.startsWith('/api/evolution/production/') && authHeader !== `Bearer ${stats.activeAccessToken}`) {
        throw unauthorizedError(config);
      }

      if (path.endsWith('/api/evolution/production/telemetry/recent')) {
        return {
          status: 200,
          data: {
            success: true,
            data: {
              car_id: 'car-44',
              total_points: 3,
              points: [],
              summary: {
                count: 3,
                avg_speed_kph: 302.2,
                avg_downforce_n: 4420,
                avg_drag_n: 1280,
                avg_efficiency: 3.45,
              },
            },
          },
        };
      }

      if (path.endsWith('/api/evolution/production/digital-twin/state')) {
        return {
          status: 200,
          data: {
            success: true,
            data: {
              twin_id: 'twin-car-44',
              recommendations: { drs_open: true, flap_angle_deg: 6.1 },
            },
          },
        };
      }

      if (path.endsWith('/api/evolution/production/telemetry/summary')) {
        return {
          status: 200,
          data: {
            success: true,
            data: {
              fleet_summary: { cars_monitored: 1, total_window_points: 3 },
              cars: [],
            },
          },
        };
      }

      if (path.endsWith('/api/evolution/production/stream/status')) {
        return {
          status: 200,
          data: {
            success: true,
            data: { connected_clients: 1 },
          },
        };
      }

      return { status: 200, data: {} };
    });

    await act(async () => {
      root.render(<ProductionTwinDashboard />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitForCondition(() => {
      expect(stats.refreshCalls).toBeGreaterThanOrEqual(0);
    });
    await waitForCondition(() => {
      expect(stats.refreshCalls).toBe(1);
    });

    localStorage.setItem('auth_token', 'stale-token-again');
    axios.defaults.headers.common.Authorization = 'Bearer stale-token-again';
    const refreshButton = Array.from(container.querySelectorAll('button'))
      .find((button) => String(button.textContent || '').trim() === 'Refresh');
    expect(refreshButton).toBeDefined();
    await act(async () => {
      refreshButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForCondition(() => {
      expect(stats.refreshCalls).toBe(2);
    });
    await waitForCondition(() => {
      expect(localStorage.getItem('auth_token')).toBe('fresh-token-2');
    });
  });
});
