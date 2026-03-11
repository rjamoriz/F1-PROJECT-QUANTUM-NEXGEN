#!/usr/bin/env node

/**
 * Phase 2 live rollout approval workflow.
 *
 * Executes strict readiness checks against:
 *   GET /api/quantum/providers/reliability-rollout-readiness
 * and, when approved, exports a deployment-ready env pack from:
 *   GET /api/quantum/providers/reliability-calibration
 */

const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');

const DEFAULT_BASE_URL = process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost:3001';
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'calibration', 'quantum', 'live-approved');
const DEFAULT_SOURCE = normalizeSourceTag(process.env.QUANTUM_RELIABILITY_COLLECTOR_SOURCE || '');
const DEFAULT_SOURCE_BY_ENV = parseSourceByEnv(process.env.QUANTUM_RELIABILITY_COLLECTOR_SOURCE_BY_ENV || '');

const ENV_PROFILE_DEFAULTS = {
  dev: {
    lookback_minutes: 240,
    bucket_seconds: 60,
    min_buckets: 8,
    min_signal_buckets: 8,
    min_live_signal_buckets: 4,
    require_live_source: false,
    require_recent_samples: false,
    max_sample_age_seconds: 3600,
    require_confidence: 'medium',
    max_fallback_ratio_percent: 60,
  },
  staging: {
    lookback_minutes: 720,
    bucket_seconds: 120,
    min_buckets: 12,
    min_signal_buckets: 10,
    min_live_signal_buckets: 8,
    require_live_source: true,
    require_recent_samples: true,
    max_sample_age_seconds: 1800,
    require_confidence: 'medium',
    max_fallback_ratio_percent: 25,
  },
  prod: {
    lookback_minutes: 1440,
    bucket_seconds: 120,
    min_buckets: 12,
    min_signal_buckets: 12,
    min_live_signal_buckets: 12,
    require_live_source: true,
    require_recent_samples: true,
    max_sample_age_seconds: 900,
    require_confidence: 'high',
    max_fallback_ratio_percent: 10,
  },
};

function parseArgs(argv = []) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
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
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.round(numeric), min), max);
}

function toBoundedNumber(value, fallback, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeConfidence(value, fallback = 'medium') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['low', 'medium', 'high'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeMode(value) {
  const normalized = String(value || 'strict').trim().toLowerCase();
  return normalized === 'allow-review' ? 'allow-review' : 'strict';
}

function normalizeSourceTag(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function parseSourceByEnv(rawValue) {
  const output = {};
  const text = String(rawValue || '').trim();
  if (!text) {
    return output;
  }

  text.split(',').forEach((entry) => {
    const item = String(entry || '').trim();
    if (!item) return;
    const separatorIndex = item.indexOf(':');
    if (separatorIndex <= 0) return;
    const envName = String(item.slice(0, separatorIndex)).trim().toLowerCase();
    const source = normalizeSourceTag(item.slice(separatorIndex + 1));
    if (!envName || !source) return;
    output[envName] = source;
  });

  return output;
}

function resolveSourceForEnvironment(environment, defaultSource, sourceByEnv) {
  const envKey = String(environment || '').trim().toLowerCase();
  if (!envKey) return defaultSource || null;
  return sourceByEnv[envKey] || defaultSource || null;
}

function usage() {
  return `Usage:
  node scripts/approve_quantum_live_rollout.js --environment <env> [options]

Options:
  --environment <name>              Environment profile: dev|staging|prod (required)
  --base-url <url>                  Backend base URL (default: ${DEFAULT_BASE_URL})
  --source <tag>                    Filter readiness/calibration by reliability source tag
  --source-by-env <csv>             Per-env source mapping (ex: dev:collector-dev,prod:collector-prod)
  --mode <strict|allow-review>      strict blocks non-approved output (default: strict)
  --output-dir <path>               Output directory for env/report files
  --lookback-minutes <n>            Readiness/calibration lookback window
  --bucket-seconds <n>              Readiness/calibration bucket size
  --min-buckets <n>                 Minimum buckets required for confidence calculations
  --min-signal-buckets <n>          Minimum signal buckets per provider for rollout gate
  --require-live-source <bool>      Require live-source hardware signal for rollout gate
  --min-live-signal-buckets <n>     Minimum live-source signal buckets per provider
  --require-recent-samples <bool>   Require recent samples for each provider
  --max-sample-age-seconds <n>      Max age allowed for latest provider sample
  --require-confidence <level>      low | medium | high
  --max-fallback-ratio-percent <n>  Max fallback ratio allowed by rollout gate
  --allow-fallback-source <bool>    Allow fallback-only calibration source (default: false)
  --enforce-availability <bool>     Enforce provider availability target (default: true)
  --require-persistence <bool>      Require Mongo-backed reliability store (default: true)
  --output-file <path>              Output env file path
  --report-file <path>              Output report JSON path
  --help                            Show this help
`;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeEnvOverrides(overrides = {}) {
  const output = {
    QUANTUM_ALERT_VQE_QUEUE_LENGTH: toPositiveInt(overrides.QUANTUM_ALERT_VQE_QUEUE_LENGTH, 20, 1, 5000),
    QUANTUM_ALERT_DWAVE_QUEUE_LENGTH: toPositiveInt(overrides.QUANTUM_ALERT_DWAVE_QUEUE_LENGTH, 25, 1, 5000),
    QUANTUM_ALERT_VQE_ERROR_RATE_PERCENT: toBoundedNumber(overrides.QUANTUM_ALERT_VQE_ERROR_RATE_PERCENT, 1.2, 0.01, 100),
    QUANTUM_ALERT_DWAVE_ERROR_RATE_PERCENT: toBoundedNumber(overrides.QUANTUM_ALERT_DWAVE_ERROR_RATE_PERCENT, 1.6, 0.01, 100),
    QUANTUM_SLO_PROVIDER_AVAILABILITY_TARGET: toBoundedNumber(overrides.QUANTUM_SLO_PROVIDER_AVAILABILITY_TARGET, 99, 80, 100),
  };
  return output;
}

function formatOutputEnv({
  environment,
  mode,
  rolloutStatus,
  readiness,
  calibrationSource,
  calibrationQuery,
  sampleSource,
  envOverrides,
}) {
  return [
    '# Auto-generated by approve_quantum_live_rollout.js',
    `# Generated at: ${new Date().toISOString()}`,
    `# Environment: ${environment}`,
    `# Mode: ${mode}`,
    `# Rollout status: ${rolloutStatus}`,
    `# Readiness confidence: ${readiness?.readiness?.confidence_level || 'unknown'}`,
    `# Calibration source: ${calibrationSource}`,
    `# Sample source tag: ${sampleSource || 'all'}`,
    `# Inputs: lookback_minutes=${calibrationQuery.lookback_minutes}, bucket_seconds=${calibrationQuery.bucket_seconds}, min_buckets=${calibrationQuery.min_buckets}, source=${sampleSource || 'all'}`,
    '',
    '# Recommended calibration thresholds',
    `QUANTUM_ALERT_VQE_QUEUE_LENGTH=${envOverrides.QUANTUM_ALERT_VQE_QUEUE_LENGTH}`,
    `QUANTUM_ALERT_DWAVE_QUEUE_LENGTH=${envOverrides.QUANTUM_ALERT_DWAVE_QUEUE_LENGTH}`,
    `QUANTUM_ALERT_VQE_ERROR_RATE_PERCENT=${envOverrides.QUANTUM_ALERT_VQE_ERROR_RATE_PERCENT}`,
    `QUANTUM_ALERT_DWAVE_ERROR_RATE_PERCENT=${envOverrides.QUANTUM_ALERT_DWAVE_ERROR_RATE_PERCENT}`,
    `QUANTUM_SLO_PROVIDER_AVAILABILITY_TARGET=${envOverrides.QUANTUM_SLO_PROVIDER_AVAILABILITY_TARGET}`,
    `QUANTUM_RELIABILITY_COLLECTOR_SOURCE=${sampleSource || ''}`,
    '',
    '# Rollout policy lock values',
    `QUANTUM_ROLLOUT_MIN_CONFIDENCE=${readiness?.policy?.required_confidence || 'medium'}`,
    `QUANTUM_ROLLOUT_ALLOW_FALLBACK_SOURCE=${String(readiness?.policy?.allow_fallback_source ?? false)}`,
    `QUANTUM_ROLLOUT_MIN_SIGNAL_BUCKETS=${toPositiveInt(readiness?.policy?.min_signal_buckets, calibrationQuery.min_buckets, 1, 240)}`,
    `QUANTUM_ROLLOUT_REQUIRE_LIVE_SOURCE=${String(readiness?.policy?.require_live_source ?? true)}`,
    `QUANTUM_ROLLOUT_MIN_LIVE_SIGNAL_BUCKETS=${toPositiveInt(readiness?.policy?.min_live_signal_buckets, calibrationQuery.min_buckets, 1, 240)}`,
    `QUANTUM_ROLLOUT_REQUIRE_RECENT_SAMPLES=${String(readiness?.policy?.require_recent_samples ?? false)}`,
    `QUANTUM_ROLLOUT_MAX_SAMPLE_AGE_MS=${toPositiveInt(readiness?.policy?.max_sample_age_ms, 1800000, 30000, 86400000)}`,
    `QUANTUM_ROLLOUT_ENFORCE_AVAILABILITY_TARGET=${String(readiness?.policy?.enforce_availability_target ?? true)}`,
    `QUANTUM_ROLLOUT_MAX_FALLBACK_RATIO_PERCENT=${toBoundedNumber(readiness?.policy?.max_fallback_ratio_percent, 35, 0, 100)}`,
    `QUANTUM_ROLLOUT_REQUIRE_PERSISTED_STORE=${String(readiness?.policy?.require_persistence ?? true)}`,
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const environment = String(args.environment || '').trim();
  if (!environment) {
    process.stderr.write('Missing required option: --environment\n');
    process.stderr.write(usage());
    process.exit(1);
    return;
  }

  const mode = normalizeMode(args.mode);
  const defaults = ENV_PROFILE_DEFAULTS[environment] || ENV_PROFILE_DEFAULTS.dev;
  const baseUrl = String(args['base-url'] || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const outputDir = path.resolve(process.cwd(), String(args['output-dir'] || DEFAULT_OUTPUT_DIR));
  const defaultSource = normalizeSourceTag(args.source || DEFAULT_SOURCE);
  const sourceByEnv = {
    ...DEFAULT_SOURCE_BY_ENV,
    ...parseSourceByEnv(args['source-by-env']),
  };
  const sampleSource = resolveSourceForEnvironment(environment, defaultSource, sourceByEnv);

  const rolloutQuery = {
    lookback_minutes: toPositiveInt(args['lookback-minutes'], defaults.lookback_minutes, 1, 60 * 24 * 30),
    bucket_seconds: toPositiveInt(args['bucket-seconds'], defaults.bucket_seconds, 10, 3600),
    min_buckets: toPositiveInt(args['min-buckets'], defaults.min_buckets, 2, 240),
    min_signal_buckets: toPositiveInt(args['min-signal-buckets'], defaults.min_signal_buckets, 1, 240),
    require_live_source: parseBoolean(args['require-live-source'], defaults.require_live_source),
    min_live_signal_buckets: toPositiveInt(args['min-live-signal-buckets'], defaults.min_live_signal_buckets, 1, 240),
    require_recent_samples: parseBoolean(args['require-recent-samples'], defaults.require_recent_samples),
    max_sample_age_seconds: toPositiveInt(args['max-sample-age-seconds'], defaults.max_sample_age_seconds, 30, 24 * 60 * 60),
    require_confidence: normalizeConfidence(args['require-confidence'], defaults.require_confidence),
    allow_fallback_source: parseBoolean(args['allow-fallback-source'], false),
    enforce_availability: parseBoolean(args['enforce-availability'], true),
    require_persistence: parseBoolean(args['require-persistence'], true),
    max_fallback_ratio_percent: toBoundedNumber(args['max-fallback-ratio-percent'], defaults.max_fallback_ratio_percent, 0, 100),
    include_windows: false,
  };
  if (sampleSource) {
    rolloutQuery.source = sampleSource;
  }

  const calibrationQuery = {
    lookback_minutes: rolloutQuery.lookback_minutes,
    bucket_seconds: rolloutQuery.bucket_seconds,
    min_buckets: rolloutQuery.min_buckets,
    include_windows: false,
  };
  if (sampleSource) {
    calibrationQuery.source = sampleSource;
  }

  const client = axios.create({
    baseURL: baseUrl,
    timeout: 30000,
    validateStatus: (status) => status >= 200 && status < 500,
  });

  const readinessResponse = await client.get('/api/quantum/providers/reliability-rollout-readiness', {
    params: rolloutQuery,
  });
  if (readinessResponse.status >= 400 || !readinessResponse?.data?.success) {
    throw new Error(`Rollout readiness request failed (${readinessResponse.status}).`);
  }

  const readiness = readinessResponse.data.data || {};
  const approved = Boolean(readiness?.readiness?.approved);
  const rolloutStatus = String(readiness?.readiness?.status || (approved ? 'approved' : 'review_required'));
  const blockers = Array.isArray(readiness?.readiness?.blockers) ? readiness.readiness.blockers : [];

  const calibrationResponse = await client.get('/api/quantum/providers/reliability-calibration', {
    params: calibrationQuery,
  });
  if (calibrationResponse.status >= 400 || !calibrationResponse?.data?.success) {
    throw new Error(`Reliability calibration request failed (${calibrationResponse.status}).`);
  }
  const calibration = calibrationResponse.data.data || {};
  const envOverrides = normalizeEnvOverrides(calibration?.recommendations?.env_overrides || {});

  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = path.resolve(
    process.cwd(),
    String(args['output-file'] || path.join(outputDir, `${environment}.quantum-live-approved.env`))
  );
  const reportFile = path.resolve(
    process.cwd(),
    String(args['report-file'] || `${outputFile}.report.json`)
  );

  const reportPayload = {
    generated_at: new Date().toISOString(),
    environment,
    mode,
    base_url: baseUrl,
    sample_source: sampleSource || null,
    rollout_query: rolloutQuery,
    calibration_query: calibrationQuery,
    readiness_status: rolloutStatus,
    approved,
    blockers,
    readiness,
    calibration_summary: {
      confidence: calibration?.confidence || {},
      sample_counts: calibration?.sample_counts || {},
      signal_quality: calibration?.signal_quality || {},
      source: calibration?.recommendations?.source || 'unknown',
    },
    output_file: outputFile,
    output_status: approved ? 'approved' : (mode === 'allow-review' ? 'review_required' : 'blocked'),
  };

  await fs.mkdir(path.dirname(reportFile), { recursive: true });
  await fs.writeFile(reportFile, `${JSON.stringify(reportPayload, null, 2)}\n`, 'utf8');

  if (!approved && mode === 'strict') {
    process.stderr.write(`Live rollout approval failed for ${environment}. See report: ${reportFile}\n`);
    process.stderr.write(`Blockers: ${blockers.map((blocker) => blocker.code).join(', ') || 'unknown'}\n`);
    process.exit(1);
    return;
  }

  const outputContent = formatOutputEnv({
    environment,
    mode,
    rolloutStatus,
    readiness,
    calibrationSource: String(calibration?.recommendations?.source || 'unknown'),
    calibrationQuery,
    sampleSource,
    envOverrides,
  });

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, outputContent, 'utf8');

  process.stdout.write(`Quantum live rollout pack generated: ${outputFile}\n`);
  process.stdout.write(`Report: ${reportFile}\n`);
  if (!approved) {
    process.stdout.write('Status: review_required (allow-review mode)\n');
  }
}

main().catch((error) => {
  process.stderr.write(`Live rollout approval failed: ${error.message}\n`);
  process.exit(1);
});
