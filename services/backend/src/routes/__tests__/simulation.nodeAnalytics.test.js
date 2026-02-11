const express = require('express');
const request = require('supertest');

const mockNodes = Array.from({ length: 8 }, (_, idx) => {
  const spanIndex = Math.floor(idx / 4);
  const chordIndex = idx % 4;
  const lift = 72 - idx * 2.4 + spanIndex * 1.2;
  const drag = 8.5 + chordIndex * 0.55 + spanIndex * 0.35;

  return {
    node_id: idx,
    span_index: spanIndex,
    chord_index: chordIndex,
    position: [0.08 + chordIndex * 0.045, -0.42 + spanIndex * 0.84, 0.01 * (chordIndex + 1)],
    gamma: 0.35 + idx * 0.025,
    cp: -0.95 + idx * 0.07,
    lift,
    drag,
    side_force: 0.0,
    force_vector: [-drag, 0.0, lift],
  };
});

const mockPhysicsResponse = {
  cl: 2.42,
  cd: 0.41,
  cm: -0.08,
  l_over_d: 5.902,
  lift: 1320.0,
  drag: 225.0,
  side_force: 0.0,
  moment: 48.0,
  pressure: mockNodes.map((node) => node.cp),
  gamma: mockNodes.map((node) => node.gamma),
  lattice_nodes: mockNodes,
};

const mockPhysicsPost = jest.fn(async () => ({ data: mockPhysicsResponse }));
const mockMlPost = jest.fn(async () => ({
  data: {
    cl: 2.31,
    cd: 0.43,
    cm: -0.07,
    confidence: 0.62,
    inference_time_ms: 0.24,
    cached: false,
    gpu_used: false,
  },
}));
const mockQuantumPost = jest.fn(async (_url, body) => {
  const n = Array.isArray(body?.qubo_matrix) ? body.qubo_matrix.length : 0;
  return {
    data: {
      solution: Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : 0)),
      cost: -0.1725,
      iterations: 12,
      computation_time_ms: 9.2,
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
      submission: { job_id: 'mock-job' },
      completed: {
        engine: 'mock-cfd',
        result: {
          metrics: {
            cl: 2.4,
            cd: 0.4,
            cm: -0.08,
            residual_l2: 0.001,
            solver: 'mock-steady-rans',
          },
        },
      },
    })),
    getJobStatus: jest.fn(async () => null),
  })),
}));

describe('Simulation route node analytics contract', () => {
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

  test('returns node_analytics structure in run + fetch contracts', async () => {
    const runResponse = await request(app)
      .post('/api/simulation/run')
      .send({
        geometry: {
          span: 1.2,
          chord: 0.28,
          twist: -1.0,
          dihedral: 0.0,
          sweep: 6.0,
          taper_ratio: 0.75,
        },
        conditions: {
          velocity: 72,
          alpha: 4.5,
          yaw: 0.5,
          rho: 1.225,
          n_panels_x: 20,
          n_panels_y: 10,
        },
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
      });

    expect(runResponse.status).toBe(200);
    expect(runResponse.body.success).toBe(true);

    const simulation = runResponse.body.data;
    const analytics = simulation?.visualizations?.node_analytics;

    expect(analytics).toEqual(expect.objectContaining({
      total_nodes: expect.any(Number),
      selected_nodes: expect.any(Number),
      selected_ratio: expect.any(Number),
      top_lift_nodes: expect.any(Array),
      top_drag_nodes: expect.any(Array),
      spanwise_distribution: expect.any(Array),
    }));

    expect(analytics.total_nodes).toBeGreaterThan(0);
    expect(analytics.selected_nodes).toBeGreaterThan(0);
    expect(analytics.selected_nodes).toBeLessThanOrEqual(analytics.total_nodes);
    expect(analytics.selected_ratio).toBeGreaterThanOrEqual(0);
    expect(analytics.selected_ratio).toBeLessThanOrEqual(1);
    expect(typeof analytics.lift_drag_correlation === 'number' || analytics.lift_drag_correlation === null).toBe(true);

    expect(analytics.top_lift_nodes[0]).toEqual(expect.objectContaining({
      node_id: expect.any(Number),
      span_index: expect.any(Number),
      chord_index: expect.any(Number),
      lift: expect.any(Number),
      drag: expect.any(Number),
      selected: expect.any(Boolean),
    }));

    expect(analytics.top_drag_nodes[0]).toEqual(expect.objectContaining({
      node_id: expect.any(Number),
      span_index: expect.any(Number),
      chord_index: expect.any(Number),
      lift: expect.any(Number),
      drag: expect.any(Number),
      selected: expect.any(Boolean),
    }));

    expect(analytics.spanwise_distribution[0]).toEqual(expect.objectContaining({
      span_index: expect.any(Number),
      nodes: expect.any(Number),
      selected_nodes: expect.any(Number),
      selected_ratio: expect.any(Number),
      avg_lift: expect.any(Number),
      avg_drag: expect.any(Number),
    }));

    const simulationId = simulation.simulation_id;
    expect(simulationId).toEqual(expect.any(String));

    const fetchResponse = await request(app).get(`/api/simulation/${simulationId}`);
    expect(fetchResponse.status).toBe(200);
    expect(fetchResponse.body.success).toBe(true);

    const fetchedAnalytics = fetchResponse.body?.data?.visualizations?.node_analytics;
    expect(fetchedAnalytics).toEqual(expect.objectContaining({
      total_nodes: analytics.total_nodes,
      selected_nodes: analytics.selected_nodes,
      selected_ratio: analytics.selected_ratio,
    }));
  });

  test('returns pareto, candidate generation, and timeline contracts', async () => {
    const runResponse = await request(app)
      .post('/api/simulation/run')
      .send({
        geometry: {
          span: 1.22,
          chord: 0.3,
          twist: -1.2,
          dihedral: 0.5,
          sweep: 8.0,
          taper_ratio: 0.72,
        },
        conditions: {
          velocity: 75,
          alpha: 4.8,
          yaw: 0.2,
          rho: 1.225,
          n_panels_x: 20,
          n_panels_y: 10,
        },
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
      });

    expect(runResponse.status).toBe(200);
    expect(runResponse.body.success).toBe(true);
    const simulationId = runResponse.body?.data?.simulation_id;
    expect(simulationId).toEqual(expect.any(String));

    const paretoResponse = await request(app)
      .get('/api/simulation/pareto')
      .query({
        limit_runs: 10,
        max_points: 20,
      });

    expect(paretoResponse.status).toBe(200);
    expect(paretoResponse.body.success).toBe(true);
    expect(paretoResponse.body.data).toEqual(expect.objectContaining({
      designs: expect.any(Array),
      summary: expect.any(Object),
      objectives: expect.any(Array),
    }));
    expect(paretoResponse.body.data.summary).toEqual(expect.objectContaining({
      total_designs: expect.any(Number),
      pareto_optimal: expect.any(Number),
      feasible_designs: expect.any(Number),
      infeasible_designs: expect.any(Number),
    }));
    expect(paretoResponse.body.data.designs.length).toBeGreaterThan(0);
    expect(paretoResponse.body.data.designs[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      simulation_id: expect.any(String),
      source: expect.any(String),
      drag: expect.any(Number),
      downforce: expect.any(Number),
      flutter_margin: expect.any(Number),
      mass: expect.any(Number),
      L_D: expect.any(Number),
      feasible: expect.any(Boolean),
      isParetoOptimal: expect.any(Boolean),
    }));

    const candidateResponse = await request(app)
      .post('/api/simulation/candidates/generate')
      .send({
        num_candidates: 5,
        target_cl: 2.75,
        target_cd: 0.39,
        target_cm: -0.08,
      });

    expect(candidateResponse.status).toBe(200);
    expect(candidateResponse.body.success).toBe(true);
    expect(candidateResponse.body.data).toEqual(expect.objectContaining({
      num_generated: 5,
      seed_count: expect.any(Number),
      target_cl: expect.any(Number),
      target_cd: expect.any(Number),
      target_cm: expect.any(Number),
      candidates: expect.any(Array),
    }));
    expect(candidateResponse.body.data.candidates).toHaveLength(5);
    expect(candidateResponse.body.data.candidates[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      candidate_id: expect.any(Number),
      seed_simulation_id: expect.any(String),
      quality_score: expect.any(Number),
      target_met: expect.any(Boolean),
      generation_time_s: expect.any(Number),
      rank: expect.any(Number),
      parameters: expect.objectContaining({
        cl: expect.any(Number),
        cd: expect.any(Number),
        cm: expect.any(Number),
        span: expect.any(Number),
        chord: expect.any(Number),
      }),
    }));

    const timelineResponse = await request(app).get(`/api/simulation/${simulationId}/timeline`);
    expect(timelineResponse.status).toBe(200);
    expect(timelineResponse.body.success).toBe(true);
    expect(timelineResponse.body.data).toEqual(expect.objectContaining({
      simulation_id: simulationId,
      status: expect.any(String),
      total_duration_s: expect.any(Number),
      stages: expect.any(Array),
    }));
    expect(timelineResponse.body.data.stages.length).toBeGreaterThanOrEqual(6);
    expect(timelineResponse.body.data.stages[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      name: expect.any(String),
      status: expect.any(String),
    }));
    const stageIds = timelineResponse.body.data.stages.map((stage) => stage.id);
    expect(stageIds).toEqual(expect.arrayContaining([
      'physics',
      'ml',
      'quantum',
      'cfd_proxy',
      'analysis',
      'report',
    ]));
  });
});
