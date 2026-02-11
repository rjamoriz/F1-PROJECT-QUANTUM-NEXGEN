const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({
  get: jest.fn(async () => ({
    data: {
      data: {
        active_jobs: 2,
        simulations: [
          { simulation_id: 'sim-a', status: 'completed' },
          { simulation_id: 'sim-b', status: 'running' },
          { simulation_id: 'sim-c', status: 'failed' },
        ],
      },
    },
  })),
}));

jest.mock('../../utils/serviceClient', () => {
  const createServiceClient = jest.fn((serviceName) => ({
    get: jest.fn(async (endpoint) => {
      if (serviceName === 'ML Surrogate' && String(endpoint).includes('stats')) {
        return {
          data: {
            mode: 'test',
            cache: {
              requests: 50,
              hits: 30,
            },
            predictor: {
              model: 'xgboost',
            },
          },
        };
      }

      return {
        data: {
          status: 'healthy',
          service: serviceName,
        },
      };
    }),
  }));

  const healthCheck = jest.fn(async (client, endpoint) => {
    try {
      const response = await client.get(endpoint);
      return {
        healthy: true,
        status: response.data,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
      };
    }
  });

  return {
    createServiceClient,
    healthCheck,
  };
});

describe('System route health contract', () => {
  let app;
  const originalBackendPublicUrl = process.env.BACKEND_PUBLIC_URL;
  const originalBackendSelfUrl = process.env.BACKEND_SELF_URL;

  beforeAll(() => {
    delete process.env.BACKEND_PUBLIC_URL;
    delete process.env.BACKEND_SELF_URL;

    const systemRoutes = require('../system');
    app = express();
    app.use('/api/system', systemRoutes);
  });

  afterAll(() => {
    if (originalBackendPublicUrl === undefined) {
      delete process.env.BACKEND_PUBLIC_URL;
    } else {
      process.env.BACKEND_PUBLIC_URL = originalBackendPublicUrl;
    }

    if (originalBackendSelfUrl === undefined) {
      delete process.env.BACKEND_SELF_URL;
    } else {
      process.env.BACKEND_SELF_URL = originalBackendSelfUrl;
    }
  });

  test('returns aggregated health payload with proxy-aware backend endpoint', async () => {
    const response = await request(app)
      .get('/api/system/health')
      .set('host', 'qaero.example')
      .set('x-forwarded-proto', 'https');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(expect.objectContaining({
      generated_at: expect.any(String),
      summary: expect.any(Object),
      services: expect.any(Array),
      simulation: expect.any(Object),
      ml_runtime: expect.any(Object),
      resources: expect.any(Object),
    }));

    const payload = response.body.data;
    const backendProbe = payload.services.find((service) => service.key === 'backend');
    expect(backendProbe).toEqual(expect.objectContaining({
      name: 'Backend API',
      status: 'healthy',
      endpoint: 'https://qaero.example/health',
    }));

    expect(payload.simulation).toEqual(expect.objectContaining({
      recent_runs: 3,
      active_jobs: 2,
      status_breakdown: expect.objectContaining({
        completed: 1,
        running: 1,
        failed: 1,
      }),
    }));

    expect(payload.ml_runtime.cache).toEqual(expect.objectContaining({
      requests: 50,
      hits: 30,
      hit_rate_percent: 60,
    }));
  });
});
