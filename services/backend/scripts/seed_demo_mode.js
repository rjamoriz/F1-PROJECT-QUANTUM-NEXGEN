#!/usr/bin/env node

/**
 * One-click demo data seeding workflow.
 *
 * Populates realistic simulation, telemetry, incident, and quantum reliability
 * data for presentation mode.
 */

const axios = require('axios');

const DEFAULT_BASE_URL = process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost:3001';
const DEFAULT_EMAIL = process.env.DEMO_SEED_EMAIL || 'admin@qaero.com';
const DEFAULT_PASSWORD = process.env.DEMO_SEED_PASSWORD || 'admin123';
const DEFAULT_CAR_IDS = ['car-44', 'car-16', 'car-4', 'car-81'];

function parseArgs(argv = []) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }
  return args;
}

function toPositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(numeric), min), max);
}

function parseList(rawValue, fallback = []) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return fallback;
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hashToUnitInterval(value = '') {
  const text = String(value || 'seed');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0) / 4294967295;
}

function randomInRange(seedText, min, max) {
  const ratio = hashToUnitInterval(seedText);
  return min + ratio * (max - min);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));
}

async function safeRequest(requestFn) {
  try {
    const response = await requestFn();
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: response.data,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: error?.response?.status || null,
      data: error?.response?.data || null,
      error,
    };
  }
}

async function authenticate(client, email, password) {
  const loginResult = await safeRequest(() => client.post('/api/auth/login', {
    email,
    password,
  }));

  if (!loginResult.ok) {
    return {
      ok: false,
      message: loginResult.error?.message || 'login_failed',
      token: null,
      refreshToken: null,
      user: null,
    };
  }

  return {
    ok: true,
    message: 'authenticated',
    token: loginResult.data?.access_token || null,
    refreshToken: loginResult.data?.refresh_token || null,
    user: loginResult.data?.user || null,
  };
}

function buildSimulationPayload(index, seed = 'demo-seed') {
  const variation = (key, min, max) => randomInRange(`${seed}:simulation:${index}:${key}`, min, max);

  return {
    geometry: {
      span: Number(variation('span', 1.4, 2.4).toFixed(4)),
      chord: Number(variation('chord', 0.22, 0.42).toFixed(4)),
      twist: Number(variation('twist', -2.5, 4.8).toFixed(4)),
      sweep: Number(variation('sweep', 3.0, 11.0).toFixed(4)),
      taper_ratio: Number(variation('taper_ratio', 0.55, 0.88).toFixed(4)),
    },
    conditions: {
      velocity: Number(variation('velocity', 68, 92).toFixed(4)),
      alpha: Number(variation('alpha', 2.5, 6.2).toFixed(4)),
      yaw: Number(variation('yaw', -1.2, 1.6).toFixed(4)),
      rho: Number(variation('rho', 1.18, 1.24).toFixed(6)),
      n_panels_x: toPositiveInt(variation('n_panels_x', 14, 26), 20, 6, 40),
      n_panels_y: toPositiveInt(variation('n_panels_y', 8, 16), 12, 6, 30),
    },
    optimization: true,
    use_quantum: true,
    use_ml_surrogate: true,
    use_cfd_adapter: true,
    coupling_iterations: toPositiveInt(variation('coupling_iterations', 2, 5), 3, 1, 8),
    optimization_weights: {
      drag: Number(variation('drag_weight', 0.8, 1.4).toFixed(4)),
      lift: Number(variation('lift_weight', 0.9, 1.6).toFixed(4)),
      max_nodes: toPositiveInt(variation('max_nodes', 18, 30), 24, 6, 40),
    },
    async_mode: true,
  };
}

async function seedSimulationRuns(client, count, seed) {
  const accepted = [];
  const completed = [];
  const failed = [];

  for (let i = 0; i < count; i += 1) {
    const payload = buildSimulationPayload(i, seed);
    const submit = await safeRequest(() => client.post('/api/simulation/run', payload));
    if (submit.ok && submit.data?.data?.simulation_id) {
      accepted.push(submit.data.data.simulation_id);
      continue;
    }
    failed.push({
      stage: 'submit',
      index: i,
      status: submit.status,
      message: submit.error?.message || submit.data?.error || 'simulation_submit_failed',
    });
  }

  for (const simulationId of accepted) {
    let terminalPayload = null;

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const lookup = await safeRequest(() => client.get(`/api/simulation/${simulationId}`));
      if (!lookup.ok || !lookup.data?.data) {
        await delay(1000);
        continue;
      }

      const status = String(lookup.data.data.status || '').toLowerCase();
      if (status && status !== 'running') {
        terminalPayload = lookup.data.data;
        break;
      }

      await delay(1200);
    }

    if (terminalPayload) {
      completed.push({
        simulation_id: simulationId,
        status: terminalPayload.status,
      });
    } else {
      failed.push({
        stage: 'poll',
        simulation_id: simulationId,
        message: 'simulation_poll_timeout',
      });
    }
  }

  return {
    accepted,
    completed,
    failed,
  };
}

function buildTelemetryPoint({ carId, pointIndex, totalPoints, seed }) {
  const prefix = `${seed}:${carId}:telemetry:${pointIndex}`;
  const phase = pointIndex / Math.max(totalPoints - 1, 1);
  const speed = randomInRange(`${prefix}:speed`, 268, 334);
  const yaw = randomInRange(`${prefix}:yaw`, -1.8, 1.8);
  const downforce = randomInRange(`${prefix}:downforce`, 3700, 5200);
  const drag = randomInRange(`${prefix}:drag`, 980, 1550);
  const batterySoc = randomInRange(`${prefix}:soc`, 28, 94);
  const ersDeploy = randomInRange(`${prefix}:ers`, 120, 310);
  const trackTemp = randomInRange(`${prefix}:track_temp`, 29, 44);
  const lap = 18 + Math.floor(phase * 6);
  const sector = (pointIndex % 3) + 1;

  return {
    car_id: carId,
    source: 'demo-seed-script',
    timestamp: new Date(Date.now() - (totalPoints - pointIndex) * 4000).toISOString(),
    lap,
    sector,
    speed_kph: Number(speed.toFixed(3)),
    yaw_deg: Number(yaw.toFixed(4)),
    downforce_n: Number(downforce.toFixed(3)),
    drag_n: Number(drag.toFixed(3)),
    battery_soc: Number(batterySoc.toFixed(3)),
    ers_deploy_kw: Number(ersDeploy.toFixed(3)),
    drs_open: speed > 305 && Math.abs(yaw) < 1.1,
    track_temp_c: Number(trackTemp.toFixed(3)),
  };
}

async function seedTelemetry(client, token, carIds, pointsPerCar, seed) {
  if (!token) {
    return {
      attempted: 0,
      accepted: 0,
      failed: 0,
      skipped: true,
      reason: 'auth_token_unavailable',
    };
  }

  let attempted = 0;
  let accepted = 0;
  let failed = 0;

  for (const carId of carIds) {
    for (let i = 0; i < pointsPerCar; i += 1) {
      attempted += 1;
      const payload = buildTelemetryPoint({
        carId,
        pointIndex: i,
        totalPoints: pointsPerCar,
        seed,
      });

      const ingest = await safeRequest(() => client.post('/api/evolution/production/telemetry/ingest', payload, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }));

      if (ingest.ok) {
        accepted += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    attempted,
    accepted,
    failed,
    skipped: false,
  };
}

function buildIncidentActionSequence(totalActions) {
  const base = [
    'ws_protection_elevated',
    'ws_protection_strict',
    'ws_protection_normal',
    'ops_manual_scale_out',
    'ops_manual_rollback',
    'invalid_action_for_denied_signal',
  ];

  return Array.from({ length: totalActions }, (_, idx) => base[idx % base.length]);
}

async function seedIncidentActions(client, totalActions, seed) {
  const sequence = buildIncidentActionSequence(totalActions);
  let applied = 0;
  let denied = 0;
  let failed = 0;

  for (let i = 0; i < sequence.length; i += 1) {
    const actionId = sequence[i];
    const result = await safeRequest(() => client.post('/api/system/observability/incident-actions/execute', {
      action_id: actionId,
      dry_run: true,
      reason: `demo-seed-${seed}-${i + 1}`,
      operator_id: 'demo-seeder',
      operator_email: 'demo-seeder@qaero.local',
    }));

    if (result.ok) {
      applied += 1;
      continue;
    }

    if (result.status === 400 || result.status === 403) {
      denied += 1;
      continue;
    }

    failed += 1;
  }

  return {
    requested: totalActions,
    applied,
    denied,
    failed,
  };
}

async function seedQuantumReliabilitySignals(client, samplePairs, seed) {
  let requests = 0;
  let successful = 0;

  for (let i = 0; i < samplePairs; i += 1) {
    const targetCl = Number(randomInRange(`${seed}:q:vqe:cl:${i}`, 2.35, 3.15).toFixed(6));
    const targetCd = Number(randomInRange(`${seed}:q:vqe:cd:${i}`, 0.33, 0.52).toFixed(6));
    const numVariables = toPositiveInt(randomInRange(`${seed}:q:vqe:num_variables:${i}`, 14, 34), 20, 4, 96);
    const numElements = toPositiveInt(randomInRange(`${seed}:q:dwave:num_elements:${i}`, 26, 72), 40, 8, 240);

    const actions = [
      () => client.get('/api/quantum/vqe/hardware-status'),
      () => client.get('/api/quantum/dwave/hardware-properties'),
      () => client.post('/api/quantum/vqe/optimize-aero', {
        num_variables: numVariables,
        target_cl: targetCl,
        target_cd: targetCd,
      }),
      () => client.post('/api/quantum/dwave/optimize-wing', {
        num_elements: numElements,
        target_cl: targetCl,
        target_cd: targetCd,
        num_reads: 700,
      }),
    ];

    for (const action of actions) {
      requests += 1;
      const result = await safeRequest(action);
      if (result.ok) {
        successful += 1;
      }
    }
  }

  return {
    requests,
    successful,
    failed: requests - successful,
  };
}

async function warmDerivedViews(client, token, carIds) {
  const warmupResults = {};

  warmupResults.pareto = await safeRequest(() => client.get('/api/simulation/pareto', {
    params: {
      limit_runs: 40,
      max_points: 120,
    },
  }));

  warmupResults.candidates = await safeRequest(() => client.post('/api/simulation/candidates/generate', {
    num_candidates: 80,
    seed_limit: 35,
    target_cl: 2.85,
    target_cd: 0.39,
    target_cm: -0.1,
  }));

  if (token) {
    warmupResults.telemetrySummary = await safeRequest(() => client.get('/api/evolution/production/telemetry/summary', {
      params: {
        car_ids: carIds.join(','),
        limit_per_car: 120,
        fallback: false,
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }));
  }

  warmupResults.incidentTrend = await safeRequest(() => client.get('/api/system/observability/incident-actions/trends', {
    params: {
      window_minutes: 1440,
      bucket_seconds: 1800,
      limit: 250,
    },
  }));

  return {
    pareto_ok: warmupResults.pareto.ok,
    candidates_ok: warmupResults.candidates.ok,
    telemetry_summary_ok: warmupResults.telemetrySummary ? warmupResults.telemetrySummary.ok : false,
    incident_trend_ok: warmupResults.incidentTrend.ok,
  };
}

function printSection(title, payload) {
  process.stdout.write(`\n${title}\n`);
  process.stdout.write(`${'-'.repeat(title.length)}\n`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      `Usage:\n  node scripts/seed_demo_mode.js [options]\n\nOptions:\n  --base-url <url>           Backend base URL (default: ${DEFAULT_BASE_URL})\n  --email <email>            Auth email for telemetry seeding (default: ${DEFAULT_EMAIL})\n  --password <password>      Auth password for telemetry seeding\n  --car-ids <csv>            Cars to seed telemetry for\n  --simulations <n>          Number of async simulation runs (default: 8)\n  --telemetry-points <n>     Telemetry points per car (default: 45)\n  --incident-actions <n>     Incident action requests (default: 16)\n  --quantum-samples <n>      Reliability sample pairs (default: 12)\n  --seed <text>              Deterministic seed label (default: demo-mode)\n  --help                     Show this help\n`
    );
    return;
  }

  const baseUrl = String(args['base-url'] || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const email = String(args.email || DEFAULT_EMAIL).trim().toLowerCase();
  const password = String(args.password || DEFAULT_PASSWORD);
  const carIds = parseList(args['car-ids'], DEFAULT_CAR_IDS);
  const simulations = toPositiveInt(args.simulations, 8, 1, 40);
  const telemetryPoints = toPositiveInt(args['telemetry-points'], 45, 1, 400);
  const incidentActions = toPositiveInt(args['incident-actions'], 16, 1, 120);
  const quantumSamples = toPositiveInt(args['quantum-samples'], 12, 1, 100);
  const seed = String(args.seed || 'demo-mode').trim();

  const client = axios.create({
    baseURL: baseUrl,
    timeout: 30000,
    validateStatus: (status) => status >= 200 && status < 500,
  });

  process.stdout.write(`Seeding demo mode data against ${baseUrl}\n`);

  const auth = await authenticate(client, email, password);
  const simulationSeed = await seedSimulationRuns(client, simulations, seed);
  const telemetrySeed = await seedTelemetry(client, auth.token, carIds, telemetryPoints, seed);
  const incidentSeed = await seedIncidentActions(client, incidentActions, seed);
  const quantumSeed = await seedQuantumReliabilitySignals(client, quantumSamples, seed);
  const warmup = await warmDerivedViews(client, auth.token, carIds);

  const summary = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    auth: {
      ok: auth.ok,
      message: auth.message,
      user: auth.user ? {
        id: auth.user.id,
        email: auth.user.email,
        role: auth.user.role,
      } : null,
    },
    simulation: {
      requested: simulations,
      accepted: simulationSeed.accepted.length,
      completed: simulationSeed.completed.length,
      failed: simulationSeed.failed.length,
      sample_ids: simulationSeed.completed.slice(0, 5).map((item) => item.simulation_id),
    },
    telemetry: {
      car_ids: carIds,
      points_per_car: telemetryPoints,
      ...telemetrySeed,
    },
    incidents: incidentSeed,
    quantum_signals: quantumSeed,
    view_warmup: warmup,
  };

  printSection('Demo Seed Summary', summary);

  if (!auth.ok) {
    process.stdout.write('\nNote: telemetry seeding requires a working Mongo-backed auth path.\n');
  }
}

main().catch((error) => {
  process.stderr.write(`Demo mode seed failed: ${error.message}\n`);
  process.exit(1);
});
