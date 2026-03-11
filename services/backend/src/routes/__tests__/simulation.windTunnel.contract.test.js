const express = require('express');
const request = require('supertest');

const mockNodes = Array.from({ length: 10 }, (_, idx) => {
  const spanIndex = Math.floor(idx / 5);
  const chordIndex = idx % 5;
  const lift = 78 - idx * 2.1 + spanIndex * 1.5;
  const drag = 7.8 + chordIndex * 0.45 + spanIndex * 0.4;

  return {
    node_id: idx,
    span_index: spanIndex,
    chord_index: chordIndex,
    position: [0.06 + chordIndex * 0.05, -0.5 + spanIndex * 1.0, 0.02 * (chordIndex + 1)],
    gamma: 0.3 + idx * 0.02,
    cp: -0.9 + idx * 0.06,
    lift,
    drag,
    side_force: 0.0,
    force_vector: [-drag, 0.0, lift],
  };
});

const mockPhysicsResponse = {
  cl: 2.52,
  cd: 0.39,
  cm: -0.07,
  l_over_d: 6.4615,
  lift: 1410.0,
  drag: 218.0,
  side_force: 0.0,
  moment: 52.0,
  pressure: mockNodes.map((node) => node.cp),
  gamma: mockNodes.map((node) => node.gamma),
  lattice_nodes: mockNodes,
};

const mockFlowFieldResponse = {
  mesh_id: 'wind_tunnel_mesh',
  vectors: [
    { position: [0.0, 0.0, 0.0], velocity: [1.0, 0.05, 0.02] },
    { position: [0.1, 0.05, 0.2], velocity: [1.08, 0.02, 0.04] },
  ],
  streamlines: [
    { points: [[0, 0, -0.4], [0, 0.02, -0.2], [0, 0.04, 0.0], [0, 0.06, 0.2]] },
  ],
  vortexCores: [
    { position: [0.0, 0.06, 0.12], radius: 0.08, strength: 1.42 },
  ],
  pressureData: [
    { position: [0.0, 0.0, 0.0], value: -0.45 },
    { position: [0.1, 0.05, 0.2], value: -0.52 },
  ],
  statistics: {
    maxVelocity: 1.08,
    minPressure: -0.52,
    maxVorticity: 2.55,
    turbulenceIntensity: 0.14,
  },
};

let failFlowFieldUpstream = false;

const mockPhysicsPost = jest.fn(async (url) => {
  if (String(url || '').includes('flow-field')) {
    if (failFlowFieldUpstream) {
      throw new Error('Flow-field unavailable');
    }
    return { data: mockFlowFieldResponse };
  }
  return { data: mockPhysicsResponse };
});

const mockMlPost = jest.fn(async () => ({
  data: {
    cl: 2.4,
    cd: 0.41,
    cm: -0.08,
    confidence: 0.66,
    inference_time_ms: 0.27,
    cached: false,
    gpu_used: false,
  },
}));

const mockQuantumPost = jest.fn(async (_url, body) => {
  const n = Array.isArray(body?.qubo_matrix) ? body.qubo_matrix.length : 0;
  return {
    data: {
      solution: Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : 0)),
      cost: -0.188,
      iterations: 14,
      computation_time_ms: 8.7,
      method: 'classical',
      success: true,
    },
  };
});

jest.mock('../../utils/serviceClient', () => ({
  createServiceClient: jest.fn((name) => {
    if (name === 'Physics Engine') {
      return { post: mockPhysicsPost };
    }
    if (name === 'ML Surrogate') {
      return { post: mockMlPost };
    }
    if (name === 'Quantum Optimizer') {
      return { post: mockQuantumPost };
    }
    return { post: jest.fn(), get: jest.fn() };
  }),
  retryRequest: jest.fn(async (fn) => fn()),
}));

jest.mock('../../config/redis', () => ({
  cache: {
    set: jest.fn(async () => true),
    get: jest.fn(async () => null),
  },
}));

jest.mock('../../services/cfdAdapter', () => ({
  createCFDAdapter: jest.fn(() => ({
    engineName: 'mock-cfd',
    evaluateCase: jest.fn(async () => ({
      submission: { job_id: 'mock-cfd-job' },
      completed: {
        engine: 'mock-cfd',
        result: {
          metrics: {
            cl: 2.45,
            cd: 0.38,
            cm: -0.08,
            residual_l2: 0.0011,
            solver: 'mock-steady-rans',
          },
        },
      },
    })),
    getJobStatus: jest.fn(async () => null),
  })),
}));

describe('Simulation route wind tunnel contracts', () => {
  const simulationRoutes = require('../simulation');
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/simulation', simulationRoutes);
    app.use((err, req, res, _next) => {
      res.status(err.status || 500).json({
        success: false,
        error: err.message,
      });
    });
  });

  beforeEach(() => {
    failFlowFieldUpstream = false;
    mockPhysicsPost.mockClear();
    mockMlPost.mockClear();
    mockQuantumPost.mockClear();
  });

  test('returns wind tunnel config contract', async () => {
    const response = await request(app).get('/api/simulation/wind-tunnel/config');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(expect.objectContaining({
      contract_version: expect.any(String),
      scenarios: expect.any(Array),
      default_request: expect.any(Object),
      response_contract: expect.any(Object),
    }));

    expect(response.body.data.scenarios.length).toBeGreaterThanOrEqual(3);
    expect(response.body.data.scenarios[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
      focus_surfaces: expect.any(Array),
      default_geometry: expect.any(Object),
      default_conditions: expect.any(Object),
      recommended: expect.any(Boolean),
    }));
  });

  test('runs wind tunnel contract and retrieves session by id', async () => {
    const runResponse = await request(app)
      .post('/api/simulation/wind-tunnel/run')
      .send({
        scenario_id: 'front_wing_high_downforce',
        conditions: {
          velocity: 76,
          alpha: 5.0,
          yaw: 0.7,
          rho: 1.225,
          n_panels_x: 20,
          n_panels_y: 10,
        },
        simulation: {
          optimization: true,
          use_quantum: false,
          use_ml_surrogate: false,
          use_cfd_adapter: false,
          coupling_iterations: 2,
          optimization_weights: {
            drag: 1.0,
            lift: 1.0,
            max_nodes: 8,
          },
        },
      });

    expect(runResponse.status).toBe(200);
    expect(runResponse.body.success).toBe(true);

    const payload = runResponse.body.data;
    expect(payload).toEqual(expect.objectContaining({
      wind_tunnel_session_id: expect.any(String),
      contract_version: expect.any(String),
      scenario: expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
      }),
      flow_field: expect.objectContaining({
        vectors: expect.any(Array),
        streamlines: expect.any(Array),
        vortexCores: expect.any(Array),
        pressureData: expect.any(Array),
        statistics: expect.any(Object),
        counts: expect.any(Object),
        source: expect.any(String),
      }),
      coupled_results: expect.objectContaining({
        simulation_id: expect.any(String),
        status: expect.any(String),
        summary: expect.any(Object),
        node_hotspots: expect.any(Object),
        workflow: expect.any(Object),
        workflow_timeline: expect.any(Array),
      }),
      references: expect.objectContaining({
        simulation_result_url: expect.any(String),
        simulation_timeline_url: expect.any(String),
        wind_tunnel_session_url: expect.any(String),
      }),
    }));

    expect(payload.flow_field.counts.vectors).toBeGreaterThan(0);
    expect(payload.flow_field.counts.streamlines).toBeGreaterThan(0);

    expect(payload.coupled_results.node_hotspots).toEqual(expect.objectContaining({
      total_nodes: expect.any(Number),
      selected_nodes: expect.any(Number),
      selected_ratio: expect.any(Number),
      top_lift_nodes: expect.any(Array),
      top_drag_nodes: expect.any(Array),
      spanwise_distribution: expect.any(Array),
    }));

    const sessionId = payload.wind_tunnel_session_id;
    const fetchResponse = await request(app).get(`/api/simulation/wind-tunnel/${sessionId}`);

    expect(fetchResponse.status).toBe(200);
    expect(fetchResponse.body.success).toBe(true);
    expect(fetchResponse.body.data.wind_tunnel_session_id).toBe(sessionId);
    expect(fetchResponse.body.data.contract_version).toBe(payload.contract_version);
  });

  test('uses fallback flow field contract when flow endpoint fails', async () => {
    failFlowFieldUpstream = true;

    const runResponse = await request(app)
      .post('/api/simulation/wind-tunnel/run')
      .send({
        scenario_id: 'rear_wing_low_drag_trim',
        simulation: {
          optimization: true,
          use_quantum: false,
          use_ml_surrogate: false,
          use_cfd_adapter: false,
          coupling_iterations: 1,
          optimization_weights: {
            drag: 1.0,
            lift: 1.0,
            max_nodes: 8,
          },
        },
      });

    expect(runResponse.status).toBe(200);
    expect(runResponse.body.success).toBe(true);

    const payload = runResponse.body.data;
    expect(payload.flow_field.source).toBe('backend-fallback');
    expect(payload.flow_field.counts.vectors).toBeGreaterThan(0);
    expect(payload.flow_field.counts.streamlines).toBeGreaterThan(0);
    expect(payload.flow_field.statistics).toEqual(expect.objectContaining({
      maxVelocity: expect.any(Number),
      minPressure: expect.any(Number),
      maxVorticity: expect.any(Number),
      turbulenceIntensity: expect.any(Number),
    }));
  });
});
