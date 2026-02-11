const express = require('express');
const request = require('supertest');

const mockQuantumGet = jest.fn(async (endpoint) => {
  if (endpoint === '/api/quantum/vqe/hardware-status') {
    return {
      data: {
        available: true,
        backend: 'ibm_simulator',
        queue_length: 2,
        num_qubits: 127,
        error_rate: 0.0011,
      },
    };
  }

  if (endpoint === '/api/quantum/vqe/circuit-metrics') {
    return {
      data: {
        num_qubits: 20,
        num_layers: 3,
        num_rotation_gates: 60,
        num_cnot_gates: 57,
        total_gates: 117,
        circuit_depth: 7,
        num_parameters: 60,
      },
    };
  }

  if (endpoint === '/api/quantum/dwave/hardware-properties') {
    return {
      data: {
        available: true,
        topology: 'Pegasus',
        num_qubits: 5640,
        connectivity: 15,
        annealing_time_range: [1, 2000],
        backend: 'advantage_system6.1',
      },
    };
  }

  return { data: {} };
});

const mockQuantumPost = jest.fn(async (endpoint, body) => {
  if (endpoint === '/api/quantum/vqe/optimize-aero') {
    return {
      data: {
        solution: Array.from({ length: body.num_variables || 20 }, (_, i) => (i % 2 === 0 ? 1 : 0)),
        energy: -1.283,
        num_iterations: 64,
        optimization_time: 5.48,
        converged: true,
        num_qubits: 24,
        circuit_depth: 9,
        backend: 'qaoa',
        target_cl: body.target_cl ?? 2.8,
        target_cd: body.target_cd ?? 0.4,
      },
    };
  }

  if (endpoint === '/api/quantum/dwave/optimize-wing') {
    const numElements = body.num_elements || 50;
    return {
      data: {
        energy: -422.5,
        num_occurrences: 37,
        num_reads: body.num_reads || 1000,
        problem_size: numElements * 6,
        backend: 'annealing',
        wing_configuration: Array.from({ length: numElements }, (_, idx) => ({
          element: idx,
          angle: -8 + idx * 0.15,
          position: idx / Math.max(numElements - 1, 1),
          flap_active: idx % 3 === 0,
        })),
        num_elements: numElements,
        target_cl: body.target_cl ?? 2.8,
        target_cd: body.target_cd ?? 0.4,
      },
    };
  }

  if (endpoint === '/qubo') {
    return {
      data: {
        solution: [1, 0, 1, 0],
        cost: -0.15,
        iterations: 24,
        computation_time_ms: 210,
        method: 'classical',
        success: true,
      },
    };
  }

  return { data: {} };
});

jest.mock('../../utils/serviceClient', () => ({
  createServiceClient: jest.fn(() => ({
    get: mockQuantumGet,
    post: mockQuantumPost,
  })),
  healthCheck: jest.fn(async () => ({ healthy: true, status: { status: 'healthy' } })),
}));

describe('Quantum compatibility route contracts', () => {
  const quantumRoutes = require('../quantum');
  const app = express();
  app.use(express.json());
  app.use('/api/quantum', quantumRoutes);
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
    });
  });

  test('returns vqe hardware-status contract shape', async () => {
    const response = await request(app).get('/api/quantum/vqe/hardware-status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      available: expect.any(Boolean),
      backend: expect.any(String),
      queue_length: expect.any(Number),
      num_qubits: expect.any(Number),
      error_rate: expect.any(Number),
    }));
  });

  test('returns vqe circuit-metrics contract shape', async () => {
    const response = await request(app)
      .get('/api/quantum/vqe/circuit-metrics')
      .query({
        num_qubits: 20,
        num_layers: 3,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      num_qubits: expect.any(Number),
      num_layers: expect.any(Number),
      num_rotation_gates: expect.any(Number),
      num_cnot_gates: expect.any(Number),
      total_gates: expect.any(Number),
      circuit_depth: expect.any(Number),
      num_parameters: expect.any(Number),
    }));
  });

  test('returns vqe optimize-aero contract shape', async () => {
    const response = await request(app)
      .post('/api/quantum/vqe/optimize-aero')
      .send({
        num_variables: 24,
        target_cl: 2.9,
        target_cd: 0.38,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      solution: expect.any(Array),
      energy: expect.any(Number),
      num_iterations: expect.any(Number),
      optimization_time: expect.any(Number),
      converged: expect.any(Boolean),
      num_qubits: expect.any(Number),
      circuit_depth: expect.any(Number),
      backend: expect.any(String),
      target_cl: expect.any(Number),
      target_cd: expect.any(Number),
    }));
  });

  test('returns dwave hardware-properties contract shape', async () => {
    const response = await request(app).get('/api/quantum/dwave/hardware-properties');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      available: expect.any(Boolean),
      topology: expect.any(String),
      num_qubits: expect.any(Number),
      connectivity: expect.any(Number),
      annealing_time_range: expect.any(Array),
      backend: expect.any(String),
    }));
  });

  test('returns dwave optimize-wing contract shape', async () => {
    const response = await request(app)
      .post('/api/quantum/dwave/optimize-wing')
      .send({
        num_elements: 50,
        target_cl: 2.8,
        target_cd: 0.4,
        num_reads: 1000,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      energy: expect.any(Number),
      num_occurrences: expect.any(Number),
      num_reads: expect.any(Number),
      problem_size: expect.any(Number),
      backend: expect.any(String),
      wing_configuration: expect.any(Array),
      num_elements: expect.any(Number),
      target_cl: expect.any(Number),
      target_cd: expect.any(Number),
    }));
    expect(response.body.wing_configuration[0]).toEqual(expect.objectContaining({
      element: expect.any(Number),
      angle: expect.any(Number),
      position: expect.any(Number),
      flap_active: expect.any(Boolean),
    }));
  });
});
