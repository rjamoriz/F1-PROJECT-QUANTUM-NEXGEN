const express = require('express');
const request = require('supertest');

const mockPhysicsPost = jest.fn(async (endpoint, body) => {
  if (endpoint === '/api/v1/flow-field') {
    return {
      data: {
        mesh_id: body.mesh_id,
        vectors: [{ position: [0, 0, 0], velocity: [1.1, 0.02, 0.01] }],
        streamlines: [{ points: [[0, 0, -1], [0, 0.02, -0.5], [0, 0.03, 0.1]] }],
        vortexCores: [{ position: [0, 0.06, 0.12], radius: 0.08, strength: 1.42 }],
        pressureData: [{ position: [0, 0, 0], value: -0.52 }],
        statistics: {
          maxVelocity: 1.11,
          minPressure: -0.52,
          maxVorticity: 2.48,
          turbulenceIntensity: 0.16,
        },
      },
    };
  }

  if (endpoint === '/api/v1/panel-solve') {
    return {
      data: {
        mesh_id: body.mesh_id,
        panels: [{ vertices: [[0, 0, 0], [0.1, 0, 0], [0.1, 0, 0.05]], indices: [0, 1, 2] }],
        sourceStrength: [0.42],
        streamlines: [{ points: [[0, 0.08, -0.2], [0, 0.08, 0.1]] }],
        coefficients: {
          Cl: 2.45,
          Cd: 0.38,
          Cm: -0.11,
        },
        pressureCoefficients: [-0.84],
      },
    };
  }

  if (endpoint === '/api/vlm/batch-simulate') {
    return {
      data: {
        status: 'completed',
        n_samples: body.n_samples,
        speed_range: body.speed_range,
        yaw_range: body.yaw_range,
        summary: {
          avg_cl_preview: 2.31,
          avg_cd_preview: 0.43,
          avg_l_over_d_preview: 5.37,
        },
        samples_preview: [
          {
            sample_id: 1,
            speed_kmh: 100,
            yaw_deg: 0,
            cl: 2.2,
            cd: 0.4,
            l_over_d: 5.5,
          },
        ],
      },
    };
  }

  return { data: {} };
});

jest.mock('../../utils/serviceClient', () => ({
  createServiceClient: jest.fn(() => ({
    post: mockPhysicsPost,
    get: jest.fn(async () => ({ data: { status: 'healthy' } })),
  })),
  cachedRequest: jest.fn(async () => ({ data: {}, cached: false })),
  healthCheck: jest.fn(async () => ({ healthy: true, status: { status: 'healthy' } })),
}));

describe('Physics compatibility route contracts', () => {
  const physicsRoutes = require('../physics');
  const app = express();
  app.use(express.json());
  app.use('/api/physics', physicsRoutes);
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
    });
  });

  test('returns flow-field contract shape via backend compatibility route', async () => {
    const response = await request(app)
      .post('/api/physics/v1/flow-field')
      .send({
        mesh_id: 'wing_v3.2',
        velocity: 70,
        alpha: 5,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      mesh_id: 'wing_v3.2',
      vectors: expect.any(Array),
      streamlines: expect.any(Array),
      vortexCores: expect.any(Array),
      pressureData: expect.any(Array),
      statistics: expect.any(Object),
    }));
    expect(response.body.vectors[0]).toEqual(expect.objectContaining({
      position: expect.any(Array),
      velocity: expect.any(Array),
    }));
  });

  test('returns panel-solve contract shape via backend compatibility route', async () => {
    const response = await request(app)
      .post('/api/physics/v1/panel-solve')
      .send({
        mesh_id: 'wing_v3.2',
        velocity: 70,
        alpha: 5,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      mesh_id: 'wing_v3.2',
      panels: expect.any(Array),
      sourceStrength: expect.any(Array),
      streamlines: expect.any(Array),
      coefficients: expect.objectContaining({
        Cl: expect.any(Number),
        Cd: expect.any(Number),
        Cm: expect.any(Number),
      }),
      pressureCoefficients: expect.any(Array),
    }));
  });

  test('returns batch-simulate contract shape via backend compatibility route', async () => {
    const response = await request(app)
      .post('/api/physics/vlm/batch-simulate')
      .send({
        n_samples: 120,
        speed_range: [100, 300],
        yaw_range: [0, 8],
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      status: 'completed',
      n_samples: 120,
      speed_range: [100, 300],
      yaw_range: [0, 8],
      summary: expect.objectContaining({
        avg_cl_preview: expect.any(Number),
        avg_cd_preview: expect.any(Number),
        avg_l_over_d_preview: expect.any(Number),
      }),
      samples_preview: expect.any(Array),
    }));
    expect(response.body.samples_preview[0]).toEqual(expect.objectContaining({
      sample_id: expect.any(Number),
      speed_kmh: expect.any(Number),
      yaw_deg: expect.any(Number),
      cl: expect.any(Number),
      cd: expect.any(Number),
      l_over_d: expect.any(Number),
    }));
  });
});
