#!/usr/bin/env node

/**
 * Phase 2 sustained reliability collector.
 *
 * Continuously probes quantum provider compatibility endpoints, normalizes the
 * observations, and ingests sample batches into:
 *   POST /api/quantum/providers/reliability-samples
 *
 * This is intended to run per-environment so rollout calibration can be based
 * on sustained, source-tagged traffic windows.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DEFAULT_BASE_URL = process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost:3001';
const DEFAULT_SOURCE = String(process.env.QUANTUM_RELIABILITY_COLLECTOR_SOURCE || 'provider-collector').trim().toLowerCase();
const DEFAULT_INTERVAL_SECONDS = toPositiveInt(process.env.QUANTUM_RELIABILITY_COLLECTOR_INTERVAL_SECONDS, 30, 5, 3600);
const DEFAULT_MAX_ITERATIONS = toPositiveInt(process.env.QUANTUM_RELIABILITY_COLLECTOR_MAX_ITERATIONS, 0, 0, 1000000);
const DEFAULT_DURATION_SECONDS = toPositiveInt(process.env.QUANTUM_RELIABILITY_COLLECTOR_DURATION_SECONDS, 0, 0, 7 * 24 * 60 * 60);
const DEFAULT_MODE = normalizeMode(process.env.QUANTUM_RELIABILITY_COLLECTOR_MODE || 'status');
const DEFAULT_ALLOW_FALLBACK = parseBoolean(process.env.QUANTUM_RELIABILITY_COLLECTOR_ALLOW_FALLBACK, false);
const DEFAULT_FAIL_ON_INGEST_ERROR = parseBoolean(process.env.QUANTUM_RELIABILITY_COLLECTOR_FAIL_ON_INGEST_ERROR, true);
const DEFAULT_INGEST_TOKEN = String(
  process.env.QUANTUM_RELIABILITY_COLLECTOR_INGEST_TOKEN
  || process.env.QUANTUM_RELIABILITY_INGEST_TOKEN
  || ''
).trim();
const DEFAULT_VQE_NUM_VARIABLES = toPositiveInt(process.env.QUANTUM_RELIABILITY_COLLECTOR_VQE_NUM_VARIABLES, 20, 4, 128);
const DEFAULT_DWAVE_NUM_ELEMENTS = toPositiveInt(process.env.QUANTUM_RELIABILITY_COLLECTOR_DWAVE_NUM_ELEMENTS, 40, 8, 256);
const DEFAULT_DWAVE_NUM_READS = toPositiveInt(process.env.QUANTUM_RELIABILITY_COLLECTOR_DWAVE_NUM_READS, 900, 10, 100000);
const DEFAULT_TARGET_CL = toBoundedNumber(process.env.QUANTUM_RELIABILITY_COLLECTOR_TARGET_CL, 2.8, 0.1, 10);
const DEFAULT_TARGET_CD = toBoundedNumber(process.env.QUANTUM_RELIABILITY_COLLECTOR_TARGET_CD, 0.4, 0.01, 5);

function parseArgs(argv = []) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;

    const key = current.slice(2);
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

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function toPositiveInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.round(numeric);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function toBoundedNumber(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < min || numeric > max) return fallback;
  return Number(numeric.toFixed(6));
}

function normalizeMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'status+optimize' || normalized === 'full') {
    return 'status+optimize';
  }
  return 'status';
}

function normalizeErrorRatePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric <= 1) return Number((numeric * 100).toFixed(6));
  if (numeric <= 100) return Number(numeric.toFixed(6));
  return null;
}

function normalizeQueueLength(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

function resolveFallbackFlag(response) {
  const headerValue = String(response?.headers?.['x-qaero-upstream-fallback'] || '').trim().toLowerCase();
  if (headerValue === 'true') return true;
  if (headerValue === 'false') return false;

  if (response?.data?.fallback === true) return true;
  if (response?.data?.metadata?.fallback === true) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function helpText() {
  return `Usage:\n  node scripts/collect_quantum_reliability_samples.js [options]\n\nOptions:\n  --base-url <url>             Backend base URL (default: ${DEFAULT_BASE_URL})\n  --source <tag>               Ingest source tag (default: ${DEFAULT_SOURCE})\n  --ingest-token <token>       Optional ingest token header value\n  --mode <status|status+optimize>\n                               Probe profile (default: ${DEFAULT_MODE})\n  --interval-seconds <n>       Interval between probe batches (default: ${DEFAULT_INTERVAL_SECONDS})\n  --iterations <n>             Stop after n batches (0 = no limit, default: ${DEFAULT_MAX_ITERATIONS})\n  --duration-seconds <n>       Stop after n seconds (0 = no limit, default: ${DEFAULT_DURATION_SECONDS})\n  --allow-fallback <bool>      Include fallback probe samples in ingest payload\n                               (default: ${String(DEFAULT_ALLOW_FALLBACK)})\n  --fail-on-ingest-error <bool> Exit non-zero when ingest request fails\n                               (default: ${String(DEFAULT_FAIL_ON_INGEST_ERROR)})\n  --vqe-num-variables <n>      VQE optimize probe size (default: ${DEFAULT_VQE_NUM_VARIABLES})\n  --dwave-num-elements <n>     D-Wave optimize probe size (default: ${DEFAULT_DWAVE_NUM_ELEMENTS})\n  --dwave-num-reads <n>        D-Wave optimize probe num_reads (default: ${DEFAULT_DWAVE_NUM_READS})\n  --target-cl <n>              Optimize probe target CL (default: ${DEFAULT_TARGET_CL})\n  --target-cd <n>              Optimize probe target CD (default: ${DEFAULT_TARGET_CD})\n  --report-file <path>         Optional json summary output file\n  --help                       Show this help\n`;
}

function formatProbeFailure(error) {
  if (!error) return 'unknown_error';
  if (error.response) {
    return `http_${error.response.status}`;
  }
  if (error.code) {
    return String(error.code);
  }
  return String(error.message || 'request_failed');
}

function buildProbeDescriptors(config) {
  const probes = [
    {
      provider: 'vqe',
      operation: 'hardware_status',
      request: (client) => client.get('/api/quantum/vqe/hardware-status'),
    },
    {
      provider: 'dwave',
      operation: 'hardware_properties',
      request: (client) => client.get('/api/quantum/dwave/hardware-properties'),
    },
  ];

  if (config.mode === 'status+optimize') {
    probes.push(
      {
        provider: 'vqe',
        operation: 'optimize_aero',
        request: (client) => client.post('/api/quantum/vqe/optimize-aero', {
          num_variables: config.vqeNumVariables,
          target_cl: config.targetCl,
          target_cd: config.targetCd,
        }),
      },
      {
        provider: 'dwave',
        operation: 'optimize_wing',
        request: (client) => client.post('/api/quantum/dwave/optimize-wing', {
          num_elements: config.dwaveNumElements,
          num_reads: config.dwaveNumReads,
          target_cl: config.targetCl,
          target_cd: config.targetCd,
        }),
      }
    );
  }

  return probes;
}

async function invokeProbe(client, probe, iterationIndex) {
  const startedAt = Date.now();

  try {
    const response = await probe.request(client);
    const elapsedMs = Date.now() - startedAt;
    const payload = response?.data || {};
    const fallbackUsed = resolveFallbackFlag(response);
    const status = Number(response?.status || 0);
    const ok = status >= 200 && status < 300;

    const sample = {
      sample_id: `${probe.provider}-${probe.operation}-${Date.now()}-${iterationIndex}-${Math.random().toString(36).slice(2, 8)}`,
      provider: probe.provider,
      operation: probe.operation,
      ts: Date.now(),
      success: ok,
      fallback_used: fallbackUsed,
      upstream_error: !ok || fallbackUsed,
      latency_ms: elapsedMs,
      queue_length: normalizeQueueLength(payload?.queue_length),
      error_rate_percent: normalizeErrorRatePercent(payload?.error_rate_percent ?? payload?.error_rate),
      backend: payload?.backend ? String(payload.backend) : null,
    };

    return {
      probe: `${probe.provider}:${probe.operation}`,
      ok,
      status,
      fallback_used: fallbackUsed,
      error: null,
      sample,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    return {
      probe: `${probe.provider}:${probe.operation}`,
      ok: false,
      status: null,
      fallback_used: true,
      error: formatProbeFailure(error),
      sample: {
        sample_id: `${probe.provider}-${probe.operation}-${Date.now()}-${iterationIndex}-${Math.random().toString(36).slice(2, 8)}`,
        provider: probe.provider,
        operation: probe.operation,
        ts: Date.now(),
        success: false,
        fallback_used: true,
        upstream_error: true,
        latency_ms: elapsedMs,
        queue_length: null,
        error_rate_percent: null,
        backend: null,
      },
    };
  }
}

async function ingestSamples(client, source, samples, ingestToken) {
  const headers = {};
  if (ingestToken) {
    headers['x-quantum-ingest-token'] = ingestToken;
  }

  const response = await client.post('/api/quantum/providers/reliability-samples', {
    source,
    samples,
  }, {
    headers,
  });

  const payload = response?.data || {};
  return {
    status: Number(response?.status || 0),
    success: Boolean(payload?.success),
    accepted_count: toPositiveInt(payload?.data?.accepted_count, 0, 0, Number.MAX_SAFE_INTEGER),
    rejected_count: toPositiveInt(payload?.data?.rejected_count, 0, 0, Number.MAX_SAFE_INTEGER),
    error: payload?.error ? String(payload.error) : null,
  };
}

function shouldStop(nowMs, startedAtMs, iteration, maxIterations, maxDurationMs) {
  if (maxIterations > 0 && iteration >= maxIterations) return true;
  if (maxDurationMs > 0 && (nowMs - startedAtMs) >= maxDurationMs) return true;
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText());
    return;
  }

  const baseUrl = String(args['base-url'] || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const source = String(args.source || DEFAULT_SOURCE).trim().toLowerCase();
  const ingestToken = String(args['ingest-token'] || DEFAULT_INGEST_TOKEN).trim();
  const mode = normalizeMode(args.mode || DEFAULT_MODE);
  const intervalSeconds = toPositiveInt(args['interval-seconds'], DEFAULT_INTERVAL_SECONDS, 5, 3600);
  const maxIterations = toPositiveInt(args.iterations, DEFAULT_MAX_ITERATIONS, 0, 1000000);
  const durationSeconds = toPositiveInt(args['duration-seconds'], DEFAULT_DURATION_SECONDS, 0, 7 * 24 * 60 * 60);
  const allowFallback = parseBoolean(args['allow-fallback'], DEFAULT_ALLOW_FALLBACK);
  const failOnIngestError = parseBoolean(args['fail-on-ingest-error'], DEFAULT_FAIL_ON_INGEST_ERROR);
  const vqeNumVariables = toPositiveInt(args['vqe-num-variables'], DEFAULT_VQE_NUM_VARIABLES, 4, 128);
  const dwaveNumElements = toPositiveInt(args['dwave-num-elements'], DEFAULT_DWAVE_NUM_ELEMENTS, 8, 256);
  const dwaveNumReads = toPositiveInt(args['dwave-num-reads'], DEFAULT_DWAVE_NUM_READS, 10, 100000);
  const targetCl = toBoundedNumber(args['target-cl'], DEFAULT_TARGET_CL, 0.1, 10);
  const targetCd = toBoundedNumber(args['target-cd'], DEFAULT_TARGET_CD, 0.01, 5);
  const reportFile = args['report-file'] ? path.resolve(String(args['report-file'])) : null;

  const maxDurationMs = durationSeconds > 0 ? durationSeconds * 1000 : 0;
  const probes = buildProbeDescriptors({
    mode,
    vqeNumVariables,
    dwaveNumElements,
    dwaveNumReads,
    targetCl,
    targetCd,
  });

  if (!source) {
    process.stderr.write('Collector source cannot be empty.\n');
    process.exit(1);
    return;
  }

  const client = axios.create({
    baseURL: baseUrl,
    timeout: 25000,
    validateStatus: () => true,
  });

  const startedAtMs = Date.now();
  const summary = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    source,
    mode,
    allow_fallback: allowFallback,
    fail_on_ingest_error: failOnIngestError,
    interval_seconds: intervalSeconds,
    max_iterations: maxIterations,
    duration_seconds: durationSeconds,
    probe_count: probes.length,
    totals: {
      iterations: 0,
      probes: 0,
      probe_failures: 0,
      probe_fallbacks: 0,
      samples_collected: 0,
      samples_submitted: 0,
      samples_skipped_fallback: 0,
      ingest_accepted: 0,
      ingest_rejected: 0,
      ingest_errors: 0,
    },
    iterations: [],
  };

  process.stdout.write(
    `Starting quantum reliability collector (${mode}) against ${baseUrl} as source=${source}.\n`
  );

  let iteration = 0;
  while (!shouldStop(Date.now(), startedAtMs, iteration, maxIterations, maxDurationMs)) {
    iteration += 1;
    const iterationStartedAt = Date.now();

    const probeResults = await Promise.all(
      probes.map((probe) => invokeProbe(client, probe, iteration))
    );

    const probeFailures = probeResults.filter((item) => !item.ok).length;
    const probeFallbacks = probeResults.filter((item) => item.fallback_used).length;
    const allSamples = probeResults.map((item) => item.sample);
    const ingestSamplesList = allowFallback
      ? allSamples
      : allSamples.filter((sample) => sample.fallback_used !== true);

    let ingestStatus = {
      status: null,
      success: false,
      accepted_count: 0,
      rejected_count: 0,
      error: null,
      skipped: false,
    };

    if (ingestSamplesList.length > 0) {
      try {
        ingestStatus = await ingestSamples(client, source, ingestSamplesList, ingestToken);
        if (!ingestStatus.success || ingestStatus.status >= 400) {
          ingestStatus.error = ingestStatus.error || `ingest_failed_status_${ingestStatus.status}`;
          summary.totals.ingest_errors += 1;
          if (failOnIngestError) {
            throw new Error(`Ingest request failed (${ingestStatus.status}): ${ingestStatus.error}`);
          }
        }
      } catch (error) {
        summary.totals.ingest_errors += 1;
        ingestStatus = {
          status: null,
          success: false,
          accepted_count: 0,
          rejected_count: 0,
          error: formatProbeFailure(error),
          skipped: false,
        };
        if (failOnIngestError) {
          throw error;
        }
      }
    } else {
      ingestStatus.skipped = true;
      ingestStatus.error = 'no_non_fallback_samples';
    }

    const iterationRecord = {
      iteration,
      started_at: new Date(iterationStartedAt).toISOString(),
      duration_ms: Date.now() - iterationStartedAt,
      probes: probeResults.length,
      probe_failures: probeFailures,
      probe_fallbacks: probeFallbacks,
      samples_collected: allSamples.length,
      samples_submitted: ingestSamplesList.length,
      samples_skipped_fallback: allSamples.length - ingestSamplesList.length,
      ingest: ingestStatus,
    };

    summary.totals.iterations += 1;
    summary.totals.probes += probeResults.length;
    summary.totals.probe_failures += probeFailures;
    summary.totals.probe_fallbacks += probeFallbacks;
    summary.totals.samples_collected += allSamples.length;
    summary.totals.samples_submitted += ingestSamplesList.length;
    summary.totals.samples_skipped_fallback += allSamples.length - ingestSamplesList.length;
    summary.totals.ingest_accepted += ingestStatus.accepted_count;
    summary.totals.ingest_rejected += ingestStatus.rejected_count;
    summary.iterations.push(iterationRecord);

    process.stdout.write(
      `[collector] iteration=${iteration} probes=${probeResults.length} failures=${probeFailures} fallbacks=${probeFallbacks} submitted=${ingestSamplesList.length} accepted=${ingestStatus.accepted_count} rejected=${ingestStatus.rejected_count}${ingestStatus.error ? ` error=${ingestStatus.error}` : ''}\n`
    );

    if (shouldStop(Date.now(), startedAtMs, iteration, maxIterations, maxDurationMs)) {
      break;
    }

    await sleep(intervalSeconds * 1000);
  }

  summary.completed_at = new Date().toISOString();
  summary.duration_ms = Date.now() - startedAtMs;

  if (reportFile) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    process.stdout.write(`Collector summary written to ${reportFile}\n`);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Quantum reliability collector failed: ${error.message}\n`);
  process.exit(1);
});
