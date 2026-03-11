const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockHttpPost = jest.fn();
const mockHttpGet = jest.fn();
const mockDiffusionPost = jest.fn();
const TEST_JWT_SECRET = 'evolution-routes-test-secret';

jest.mock('axios', () => ({
  post: (...args) => mockHttpPost(...args),
  get: (...args) => mockHttpGet(...args),
  create: jest.fn(() => ({
    post: (...args) => mockDiffusionPost(...args),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));

describe('Evolution routes (Phase 3 + Phase 4) contracts', () => {
  let app;
  let envSnapshot;

  function restoreEnv(snapshot) {
    const keys = Object.keys(process.env);
    keys.forEach((key) => {
      if (!(key in snapshot)) {
        delete process.env[key];
      }
    });
    Object.entries(snapshot).forEach(([key, value]) => {
      process.env[key] = value;
    });
  }

  function issueToken({
    sub = 'viewer-44',
    role = 'viewer',
    allowedCarIds = ['car-44'],
    includeSession = false,
  } = {}) {
    const claims = {
      sub,
      role,
      allowed_car_ids: allowedCarIds,
      tv: 0,
    };
    if (includeSession) {
      claims.sid = `session-${sub}`;
    }
    return jwt.sign(
      claims,
      TEST_JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  beforeAll(() => {
    envSnapshot = { ...process.env };
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.AUTH_REQUIRE_SESSION = 'false';
    process.env.EVOLUTION_HTTP_AUTH_REQUIRED = 'true';
    process.env.EVOLUTION_HTTP_REQUIRE_SESSION = 'false';
    process.env.EVOLUTION_HTTP_ENFORCE_PERSISTED_ACL = 'false';
    process.env.EVOLUTION_HTTP_FAIL_ON_ACL_STORE_UNAVAILABLE = 'false';
    jest.resetModules();

    const evolutionRoutes = require('../evolution');
    app = express();
    app.use(express.json());
    app.use('/api/evolution', evolutionRoutes);
  });

  afterAll(() => {
    if (envSnapshot) {
      restoreEnv(envSnapshot);
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockHttpPost.mockReset();
    mockHttpGet.mockReset();
    mockDiffusionPost.mockReset();

    mockHttpGet.mockResolvedValue({
      data: {
        data: {
          points: [
            {
              id: 'pareto-default',
              objective: { efficiency: 7.2 },
              aerodynamic: { cl: 2.95, cd: 0.39, cm: -0.1 },
            },
          ],
        },
      },
    });
  });

  test('returns diffusion generation contract with simulation-seeded candidates', async () => {
    mockDiffusionPost.mockResolvedValue({
      data: {
        data: {
          model: 'aero-diffusion-v2',
          candidates: [
            {
              id: 'seed-1',
              seed_simulation_id: 'sim-1',
              quality_score: 0.82,
              parameters: {
                cl: 2.9,
                cd: 0.39,
                cm: -0.11,
                span: 1.8,
                chord: 0.28,
                twist: 2.1,
                sweep: 7.3,
                taper_ratio: 0.75,
                volume: 0.33,
              },
            },
            {
              id: 'seed-2',
              seed_simulation_id: 'sim-2',
              quality_score: 0.8,
              parameters: {
                cl: 2.7,
                cd: 0.41,
                cm: -0.08,
                span: 1.7,
                chord: 0.3,
                twist: 1.8,
                sweep: 6.8,
                taper_ratio: 0.72,
                volume: 0.35,
              },
            },
          ],
          seed_count: 2,
        },
      },
    });

    const response = await request(app)
      .post('/api/evolution/generative/diffusion/generate')
      .send({
        num_candidates: 2,
        target_cl: 2.8,
        target_cd: 0.4,
        target_cm: -0.1,
        latent_dim: 24,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      service: 'evolution',
      timestamp: expect.any(String),
      data: expect.objectContaining({
        model: expect.any(String),
        requested_candidates: 2,
        candidates: expect.any(Array),
        stats: expect.objectContaining({
          seed_count: 2,
          fallback_used: false,
          seed_source: 'diffusion-service',
        }),
      }),
    }));
    expect(response.body.data.candidates).toHaveLength(2);
    expect(response.body.data.candidates[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      quality_score: expect.any(Number),
      novelty_score: expect.any(Number),
      parameters: expect.objectContaining({
        cl: expect.any(Number),
        cd: expect.any(Number),
        cm: expect.any(Number),
      }),
    }));
  });

  test('falls back to synthetic diffusion candidates when simulation seeds are unavailable', async () => {
    mockDiffusionPost.mockRejectedValue(new Error('diffusion model unavailable'));
    mockHttpPost.mockRejectedValue(new Error('simulation service unavailable'));

    const response = await request(app)
      .post('/api/evolution/generative/diffusion/generate')
      .send({
        num_candidates: 4,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.candidates).toHaveLength(4);
    expect(response.body.data.stats).toEqual(expect.objectContaining({
      fallback_used: true,
      seed_source: expect.stringContaining('fallback'),
    }));
    expect(response.body.data.candidates[0]).toEqual(expect.objectContaining({
      source: expect.stringContaining('fallback'),
      latent_vector_norm: expect.any(Number),
    }));
  });

  test('returns RL active-control recommendation contract', async () => {
    const response = await request(app)
      .post('/api/evolution/generative/rl/recommend')
      .send({
        state: {
          speed_kph: 312,
          yaw_deg: 0.6,
          battery_soc: 64,
          tire_temp_c: 98,
          drs_available: true,
          sector: 3,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      service: 'evolution',
      data: expect.objectContaining({
        policy: expect.any(String),
        policy_metadata: expect.objectContaining({
          source: expect.any(String),
          training_run_id: expect.any(String),
          track_id: expect.any(String),
        }),
        state: expect.any(Object),
        action: expect.objectContaining({
          drs_open: expect.any(Boolean),
          flap_angle_deg: expect.any(Number),
          ers_deploy_kw: expect.any(Number),
        }),
        expected_delta: expect.objectContaining({
          downforce_n: expect.any(Number),
          drag_n: expect.any(Number),
          lap_time_ms: expect.any(Number),
        }),
        confidence: expect.any(Number),
      }),
    }));
  });

  test('creates RL training run, exposes run lookup, and lists active policy', async () => {
    mockHttpPost.mockResolvedValueOnce({
      data: {
        data: {
          run_id: 'rl_run_monza_1',
          job_id: 'job_monza_1',
          status: 'completed',
          progress_percent: 100,
          policy_name: 'ppo-active-control-monza-v2',
          metrics: {
            mean_episode_reward: 2.34,
            lap_time_gain_ms: 14.7,
            stability_score: 0.91,
          },
          action_profile: {
            drs_speed_threshold: 252,
            drs_max_yaw_deg: 1.72,
            flap_base_deg: 7.5,
            flap_speed_coeff: 0.011,
            flap_yaw_coeff: 0.44,
            ers_base_kw: 211,
            ers_drs_bonus_kw: 31,
            ers_no_drs_penalty_kw: -10,
            ers_soc_coeff: 0.37,
          },
        },
      },
    });

    const trainResponse = await request(app)
      .post('/api/evolution/generative/rl/train')
      .send({
        track_id: 'monza',
        policy_name: 'ppo-active-control-monza-v2',
        auto_deploy: true,
        config: {
          episodes: 1600,
          eval_episodes: 80,
          target_style: 'aggressive',
          learning_rate: 0.00025,
        },
      });

    expect(trainResponse.status).toBe(202);
    expect(trainResponse.body).toEqual(expect.objectContaining({
      success: true,
      service: 'evolution',
      data: expect.objectContaining({
        mode: 'service',
        run: expect.objectContaining({
          run_id: 'rl_run_monza_1',
          track_id: 'monza',
          status: 'completed',
          action_profile: expect.any(Object),
          metrics: expect.objectContaining({
            lap_time_gain_ms: expect.any(Number),
          }),
          deployment: expect.objectContaining({
            active: true,
          }),
        }),
        deployment: expect.objectContaining({
          active: true,
        }),
        run_state_machine: expect.objectContaining({
          current_state: 'completed',
        }),
      }),
    }));

    const runId = trainResponse.body.data.run.run_id;

    const lookupResponse = await request(app)
      .get(`/api/evolution/generative/rl/train/${runId}`);
    expect(lookupResponse.status).toBe(200);
    expect(lookupResponse.body.data).toEqual(expect.objectContaining({
      run_id: runId,
      track_id: 'monza',
      deployment: expect.objectContaining({
        active: true,
      }),
    }));

    const policiesResponse = await request(app)
      .get('/api/evolution/generative/rl/policies')
      .query({
        track_id: 'monza',
        active_only: 'true',
      });
    expect(policiesResponse.status).toBe(200);
    expect(policiesResponse.body.data).toEqual(expect.objectContaining({
      count: expect.any(Number),
      policies: expect.any(Array),
    }));
    expect(policiesResponse.body.data.policies.length).toBeGreaterThan(0);
    expect(policiesResponse.body.data.policies[0]).toEqual(expect.objectContaining({
      run_id: runId,
      track_id: 'monza',
      deployment: expect.objectContaining({
        active: true,
      }),
    }));

    const recommendResponse = await request(app)
      .post('/api/evolution/generative/rl/recommend')
      .send({
        state: {
          speed_kph: 325,
          yaw_deg: 0.55,
          battery_soc: 61,
          tire_temp_c: 99,
          drs_available: true,
          sector: 3,
          track_id: 'monza',
        },
      });

    expect(recommendResponse.status).toBe(200);
    expect(recommendResponse.body.data.policy_metadata).toEqual(expect.objectContaining({
      training_run_id: runId,
      source: expect.stringMatching(/trained|latest/),
      track_id: 'monza',
      active: true,
    }));
  });

  test('blocks auto-deploy for completed runs that fail rollout guardrails', async () => {
    mockHttpPost.mockResolvedValueOnce({
      data: {
        data: {
          run_id: 'rl_run_guardrail_1',
          job_id: 'job_guardrail_1',
          status: 'completed',
          progress_percent: 100,
          policy_name: 'ppo-active-control-risky-v1',
          metrics: {
            mean_episode_reward: 0.32,
            lap_time_gain_ms: 0.4,
            stability_score: 0.44,
          },
        },
      },
    });

    const response = await request(app)
      .post('/api/evolution/generative/rl/train')
      .send({
        track_id: 'global',
        auto_deploy: true,
        config: {
          episodes: 1200,
          eval_episodes: 40,
          target_style: 'aggressive',
        },
      });

    expect(response.status).toBe(202);
    expect(response.body.data).toEqual(expect.objectContaining({
      run: expect.objectContaining({
        run_id: 'rl_run_guardrail_1',
        status: 'completed',
        deployment: expect.objectContaining({
          active: false,
        }),
      }),
      deployment: expect.objectContaining({
        auto_deploy: true,
        active: false,
        guardrails: expect.objectContaining({
          eligible: false,
          blocked: true,
          reasons: expect.any(Array),
        }),
      }),
    }));
    expect(response.body.data.deployment.guardrails.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'stability_score_below_threshold' }),
      expect.objectContaining({ code: 'mean_episode_reward_below_threshold' }),
      expect.objectContaining({ code: 'lap_time_gain_below_threshold' }),
    ]));
  });

  test('ingests telemetry and exposes recent window summary contract', async () => {
    const viewerToken = issueToken({
      sub: 'viewer-car-16',
      allowedCarIds: ['car-16'],
    });
    const point = {
      car_id: 'car-16',
      lap: 21,
      sector: 2,
      speed_kph: 301,
      yaw_deg: 0.7,
      downforce_n: 4420,
      drag_n: 1290,
      battery_soc: 58,
      ers_deploy_kw: 210,
      drs_open: false,
    };

    const ingestResponse = await request(app)
      .post('/api/evolution/production/telemetry/ingest')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(point);

    expect(ingestResponse.status).toBe(202);
    expect(ingestResponse.body.data).toEqual(expect.objectContaining({
      accepted: true,
      telemetry_id: expect.any(String),
      car_id: 'car-16',
      queue_depth: expect.any(Number),
      anomalies: expect.any(Array),
    }));

    const recentResponse = await request(app)
      .get('/api/evolution/production/telemetry/recent')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({
        car_id: 'car-16',
        limit: 10,
        fallback: 'false',
      });

    expect(recentResponse.status).toBe(200);
    expect(recentResponse.body.data).toEqual(expect.objectContaining({
      car_id: 'car-16',
      total_points: expect.any(Number),
      points: expect.any(Array),
      summary: expect.objectContaining({
        count: expect.any(Number),
        avg_speed_kph: expect.any(Number),
        avg_downforce_n: expect.any(Number),
      }),
    }));
    expect(recentResponse.body.data.points.length).toBeGreaterThan(0);
  });

  test('returns digital twin state with telemetry + pareto optimization context', async () => {
    const viewerToken = issueToken({
      sub: 'viewer-car-1',
      allowedCarIds: ['car-1'],
    });
    mockHttpGet.mockResolvedValue({
      data: {
        data: {
          points: [
            {
              id: 'pareto-1',
              objective: {
                efficiency: 7.8,
              },
              aerodynamic: {
                cl: 3.02,
                cd: 0.38,
                cm: -0.09,
              },
            },
          ],
        },
      },
    });

    await request(app)
      .post('/api/evolution/production/telemetry/ingest')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        car_id: 'car-1',
        speed_kph: 314,
        yaw_deg: 0.5,
        downforce_n: 4600,
        drag_n: 1240,
        battery_soc: 62,
        drs_open: true,
      });

    const twinResponse = await request(app)
      .get('/api/evolution/production/digital-twin/state')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ car_id: 'car-1' });

    expect(twinResponse.status).toBe(200);
    expect(twinResponse.body).toEqual(expect.objectContaining({
      success: true,
      service: 'evolution',
      data: expect.objectContaining({
        twin_id: 'twin-car-1',
        state: expect.objectContaining({
          speed_kph: expect.any(Number),
          aero_efficiency: expect.any(Number),
          stability_index: expect.any(Number),
        }),
        telemetry_window: expect.objectContaining({
          count: expect.any(Number),
        }),
        optimization_context: expect.objectContaining({
          pareto_points: 1,
          source: 'simulation-pareto',
          target_cl: expect.any(Number),
          target_cd: expect.any(Number),
        }),
        recommendations: expect.objectContaining({
          drs_open: expect.any(Boolean),
          flap_angle_deg: expect.any(Number),
        }),
      }),
    }));
  });

  test('returns telemetry fleet summary contract', async () => {
    const adminToken = issueToken({
      sub: 'admin-1',
      role: 'admin',
      allowedCarIds: ['*'],
    });
    await request(app)
      .post('/api/evolution/production/telemetry/ingest')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        car_id: 'car-4',
        speed_kph: 302,
        yaw_deg: 0.6,
        downforce_n: 4480,
        drag_n: 1260,
        battery_soc: 61,
        drs_open: false,
      });

    await request(app)
      .post('/api/evolution/production/telemetry/ingest')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        car_id: 'car-81',
        speed_kph: 309,
        yaw_deg: 0.4,
        downforce_n: 4550,
        drag_n: 1235,
        battery_soc: 59,
        drs_open: true,
      });

    const response = await request(app)
      .get('/api/evolution/production/telemetry/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({
        car_ids: 'car-4,car-81',
        limit_per_car: 100,
        fallback: 'false',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      service: 'evolution',
      data: expect.objectContaining({
        limit_per_car: 100,
        fleet_summary: expect.objectContaining({
          cars_monitored: 2,
          total_window_points: expect.any(Number),
          peak_speed_kph: expect.any(Number),
          avg_speed_kph: expect.any(Number),
          anomaly_count: expect.any(Number),
        }),
        cars: expect.any(Array),
      }),
    }));
    expect(response.body.data.cars).toHaveLength(2);
    expect(response.body.data.cars[0]).toEqual(expect.objectContaining({
      car_id: expect.any(String),
      window_points: expect.any(Number),
      summary: expect.objectContaining({
        avg_speed_kph: expect.any(Number),
      }),
    }));
  });

  test('returns evolution stream status contract', async () => {
    const viewerToken = issueToken({
      sub: 'viewer-status',
      allowedCarIds: ['car-44'],
    });
    const response = await request(app)
      .get('/api/evolution/production/stream/status')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      service: 'evolution',
      data: expect.objectContaining({
        enabled: expect.any(Boolean),
        path: expect.any(String),
        connected_clients: expect.any(Number),
        auth_required: expect.any(Boolean),
        published_events: expect.any(Number),
        delivered_messages: expect.any(Number),
        events_by_type: expect.any(Object),
        dropped_messages: expect.any(Number),
        rate_limited_messages: expect.any(Number),
        auth_failures: expect.any(Number),
        unauthorized_subscriptions: expect.any(Number),
        auth_policy: expect.objectContaining({
          http_auth_required: expect.any(Boolean),
          http_require_session: expect.any(Boolean),
          http_enforce_persisted_acl: expect.any(Boolean),
          http_fail_on_acl_store_unavailable: expect.any(Boolean),
        }),
        persistence: expect.objectContaining({
          mode: expect.any(String),
          mongo_ready: expect.any(Boolean),
        }),
        limits: expect.objectContaining({
          max_buffered_bytes: expect.any(Number),
          max_messages_per_window: expect.any(Number),
          max_subscribe_per_window: expect.any(Number),
          rate_window_ms: expect.any(Number),
        }),
      }),
    }));
  });

  test('rejects production route requests without access token', async () => {
    const response = await request(app)
      .get('/api/evolution/production/telemetry/recent')
      .query({ car_id: 'car-44' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      error: 'Unauthorized',
      reason: 'missing_token',
      service: 'evolution',
      timestamp: expect.any(String),
    }));
  });

  test('rejects production access for cars outside token ACL', async () => {
    const viewerToken = issueToken({
      sub: 'viewer-car-44',
      allowedCarIds: ['car-44'],
    });

    const response = await request(app)
      .get('/api/evolution/production/telemetry/recent')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ car_id: 'car-16' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      error: 'Forbidden',
      reason: 'forbidden_car_id',
      details: {
        car_ids: ['car-16'],
      },
      service: 'evolution',
      timestamp: expect.any(String),
    }));
  });
});
