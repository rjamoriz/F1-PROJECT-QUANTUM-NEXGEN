const request = require('supertest');

const mockUsers = [];
const mockDatasets = [];

function mockBuildLeanQuery(result) {
  return {
    lean: async () => result,
  };
}

jest.mock('../../models/User', () => ({
  bulkWrite: jest.fn(async (operations) => {
    operations.forEach((operation) => {
      const filterEmail = operation?.updateOne?.filter?.email;
      const payload = operation?.updateOne?.update?.$setOnInsert;
      if (!filterEmail || !payload) {
        return;
      }
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
    const user = mockUsers.find((candidate) => candidate.email === email) || null;
    return mockBuildLeanQuery(user);
  }),
  findById: jest.fn((id) => {
    const user = mockUsers.find((candidate) => String(candidate._id) === String(id)) || null;
    return mockBuildLeanQuery(user);
  }),
  create: jest.fn(async (payload) => {
    const doc = {
      _id: `user_${mockUsers.length + 1}`,
      ...payload,
    };
    mockUsers.push(doc);
    return doc;
  }),
}));

jest.mock('../../models/Dataset', () => ({
  create: jest.fn(async (payload) => {
    const doc = {
      _id: `dataset_${mockDatasets.length + 1}`,
      ...payload,
    };
    mockDatasets.push(doc);
    return doc;
  }),
  findOne: jest.fn((query = {}) => {
    const record = mockDatasets.find((dataset) => dataset.dataset_id === query.dataset_id) || null;
    return mockBuildLeanQuery(record);
  }),
}));

const app = require('../../app');

describe('Feature route contracts (auth, aeroelastic, transient, data)', () => {
  beforeEach(() => {
    mockUsers.length = 0;
    mockDatasets.length = 0;
  });

  test('auth register/login/me flow returns token and user payload', async () => {
    const email = `engineer_${Date.now()}@qaero.dev`;
    const password = 'strongpass123';

    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Integration Engineer',
        email,
        password,
        role: 'engineer',
      });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body).toEqual(expect.objectContaining({
      token: expect.any(String),
      user: expect.objectContaining({
        id: expect.any(String),
        name: 'Integration Engineer',
        email,
        role: 'engineer',
      }),
    }));

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.token).toEqual(expect.any(String));

    const meResponse = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user).toEqual(expect.objectContaining({
      email,
      role: 'engineer',
    }));
  });

  test('aeroelastic routes return flutter + mode contracts', async () => {
    const modesResponse = await request(app)
      .get('/api/aeroelastic/modes')
      .query({ config: 'optimized' });

    expect(modesResponse.status).toBe(200);
    expect(modesResponse.body).toEqual(expect.objectContaining({
      configuration: 'optimized',
      modes: expect.any(Array),
      generated_at: expect.any(String),
    }));
    expect(modesResponse.body.modes.length).toBeGreaterThanOrEqual(3);
    expect(modesResponse.body.modes[0]).toEqual(expect.objectContaining({
      id: expect.any(Number),
      type: expect.any(String),
      frequency: expect.any(Number),
      damping: expect.any(Number),
      description: expect.any(String),
    }));

    const flutterResponse = await request(app)
      .get('/api/aeroelastic/flutter-analysis')
      .query({ config: 'optimized' });

    expect(flutterResponse.status).toBe(200);
    expect(flutterResponse.body).toEqual(expect.objectContaining({
      configuration: 'optimized',
      flutter_speed: expect.any(Number),
      flutter_margin: expect.any(Number),
      max_speed: expect.any(Number),
      safety_status: expect.any(String),
      modes: expect.any(Array),
      vg_diagram: expect.any(Array),
    }));
    expect(flutterResponse.body.vg_diagram[0]).toEqual(expect.objectContaining({
      velocity: expect.any(Number),
      mode1: expect.any(Number),
      mode2: expect.any(Number),
      mode3: expect.any(Number),
    }));
  });

  test('transient scenario route returns synchronized time-series', async () => {
    const response = await request(app)
      .post('/api/transient/run-scenario')
      .send({
        scenario_type: 'custom',
        config: {
          initial_speed: 150,
          final_speed: 225,
          duration: 2.4,
          yaw_angle: 3.2,
          ride_height_delta: -4.6,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      scenario_type: 'custom',
      config: expect.any(Object),
      time: expect.any(Array),
      downforce: expect.any(Array),
      drag: expect.any(Array),
      displacement: expect.any(Array),
      modal_energy: expect.any(Array),
      peak_downforce_reduction: expect.any(Number),
      flutter_margin: expect.any(Number),
    }));

    const n = response.body.time.length;
    expect(n).toBeGreaterThan(8);
    expect(response.body.downforce).toHaveLength(n);
    expect(response.body.drag).toHaveLength(n);
    expect(response.body.displacement).toHaveLength(n);
    expect(response.body.modal_energy).toHaveLength(n);
  });

  test('data pipeline routes return generation + storage contracts', async () => {
    const airfoilResponse = await request(app)
      .post('/api/data/generate-airfoils')
      .send({ n_profiles: 24 });

    expect(airfoilResponse.status).toBe(200);
    expect(airfoilResponse.body).toEqual(expect.objectContaining({
      success: true,
      n_profiles: 24,
      generated_profiles: expect.any(Array),
    }));

    const geometryResponse = await request(app)
      .post('/api/data/generate-geometry')
      .send({
        n_variations: 30,
        components: ['front_wing', 'rear_wing'],
      });

    expect(geometryResponse.status).toBe(200);
    expect(geometryResponse.body).toEqual(expect.objectContaining({
      success: true,
      n_variations: 30,
      components: ['front_wing', 'rear_wing'],
      generated_examples: expect.any(Array),
    }));

    const storeResponse = await request(app)
      .post('/api/data/store-dataset')
      .send({
        format: 'hdf5',
        metadata: {
          n_samples: 120,
          source: 'integration_test',
        },
      });

    expect(storeResponse.status).toBe(200);
    expect(storeResponse.body).toEqual(expect.objectContaining({
      dataset_id: expect.any(String),
      format: 'hdf5',
      total_samples: 120,
      dataset_size_mb: expect.any(Number),
      duration_seconds: expect.any(Number),
      status: 'stored',
    }));

    const getResponse = await request(app).get(`/api/data/datasets/${storeResponse.body.dataset_id}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.dataset_id).toBe(storeResponse.body.dataset_id);
  });
});
