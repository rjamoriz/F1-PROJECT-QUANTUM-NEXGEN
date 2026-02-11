const express = require('express');
const request = require('supertest');

const mockMlGet = jest.fn(async (endpoint) => {
  if (endpoint === '/api/ml/gnn-rans/mesh-graph') {
    return {
      data: {
        num_nodes: 5000,
        num_edges: 29000,
        node_features: 6,
        edge_features: 4,
      },
    };
  }

  if (endpoint === '/api/ml/gnn-rans/benchmark') {
    return {
      data: {
        results: [
          { num_nodes: 1000, solve_time_s: 0.2, nodes_per_second: 5000 },
          { num_nodes: 5000, solve_time_s: 1.0, nodes_per_second: 5000 },
          { num_nodes: 10000, solve_time_s: 2.0, nodes_per_second: 5000 },
        ],
      },
    };
  }

  return { data: {} };
});

const mockMlPost = jest.fn(async (endpoint, body) => {
  if (endpoint === '/api/v1/predict-forces') {
    return {
      data: {
        Cl: 2.73,
        Cd: 0.39,
        L_D: 7.0,
        confidence: 0.93,
        echo: body,
      },
    };
  }

  if (endpoint === '/api/ml/gnn-rans/solve') {
    return {
      data: {
        num_nodes: 5000,
        num_cells: 1250,
        solve_time_s: 0.94,
        pressure: [0.35, 0.36, 0.37],
        velocity_magnitude: [1.2, 1.21, 1.22],
      },
    };
  }

  if (endpoint === '/api/ml/gnn-rans/compare-openfoam') {
    return {
      data: {
        pressure_l2: 0.015,
        pressure_max: 0.051,
        pressure_mae: 0.012,
        velocity_magnitude_l2: 0.018,
        velocity_magnitude_max: 0.059,
        velocity_magnitude_mae: 0.014,
        speedup: 1200,
      },
    };
  }

  return { data: {} };
});

jest.mock('../../utils/serviceClient', () => ({
  createServiceClient: jest.fn(() => ({
    get: mockMlGet,
    post: mockMlPost,
  })),
  cachedRequest: jest.fn(async () => ({ data: {}, cached: false })),
  healthCheck: jest.fn(async () => ({ healthy: true, status: { status: 'healthy' } })),
}));

describe('ML compatibility route contracts', () => {
  const mlRoutes = require('../ml');
  const app = express();
  app.use(express.json());
  app.use('/api/ml', mlRoutes);
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
    });
  });

  test('returns predict-forces contract shape', async () => {
    const response = await request(app)
      .post('/api/ml/predict-forces')
      .send({
        parameters: {
          velocity: 260,
          yaw: 2.5,
          flapAngle: 9.0,
          camber: 5.2,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      Cl: expect.any(Number),
      Cd: expect.any(Number),
      L_D: expect.any(Number),
      confidence: expect.any(Number),
    }));
  });

  test('returns gnn mesh-graph contract shape', async () => {
    const response = await request(app)
      .get('/api/ml/gnn-rans/mesh-graph')
      .query({ num_nodes: 5000 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      num_nodes: expect.any(Number),
      num_edges: expect.any(Number),
      node_features: expect.any(Number),
      edge_features: expect.any(Number),
    }));
  });

  test('returns gnn solve contract shape', async () => {
    const response = await request(app)
      .post('/api/ml/gnn-rans/solve')
      .send({
        vertices: [[0, 0, 0], [1, 0, 0]],
        cells: [[0, 1, 1, 0]],
        boundary_conditions: {},
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      num_nodes: expect.any(Number),
      num_cells: expect.any(Number),
      solve_time_s: expect.any(Number),
      pressure: expect.any(Array),
      velocity_magnitude: expect.any(Array),
    }));
  });

  test('returns gnn compare-openfoam contract shape', async () => {
    const response = await request(app)
      .post('/api/ml/gnn-rans/compare-openfoam')
      .send({
        vertices: [],
        cells: [],
        boundary_conditions: {},
        openfoam_results: {
          pressure: [],
          velocity_magnitude: [],
          openfoam_time_s: 3600,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      pressure_l2: expect.any(Number),
      pressure_max: expect.any(Number),
      pressure_mae: expect.any(Number),
      velocity_magnitude_l2: expect.any(Number),
      velocity_magnitude_max: expect.any(Number),
      velocity_magnitude_mae: expect.any(Number),
      speedup: expect.any(Number),
    }));
  });

  test('returns gnn benchmark contract shape', async () => {
    const response = await request(app)
      .get('/api/ml/gnn-rans/benchmark')
      .query({ mesh_sizes: '1000,5000,10000' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      results: expect.any(Array),
    }));
    expect(response.body.results[0]).toEqual(expect.objectContaining({
      num_nodes: expect.any(Number),
      solve_time_s: expect.any(Number),
      nodes_per_second: expect.any(Number),
    }));
  });
});
