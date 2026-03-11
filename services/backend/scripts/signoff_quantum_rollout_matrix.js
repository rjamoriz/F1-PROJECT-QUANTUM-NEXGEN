#!/usr/bin/env node

/**
 * Phase 2 rollout signoff matrix workflow.
 *
 * Evaluates per-environment readiness and source freshness from the backend
 * reliability contracts, then writes a consolidated signoff report.
 */

const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');

const DEFAULT_BASE_URL = process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost:3001';
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'calibration', 'quantum', 'signoff');
const DEFAULT_ENVIRONMENTS = ['dev', 'staging', 'prod'];
const DEFAULT_SOURCE = normalizeSourceTag(process.env.QUANTUM_RELIABILITY_COLLECTOR_SOURCE || '');
const DEFAULT_SOURCE_BY_ENV = parseSourceByEnv(process.env.QUANTUM_RELIABILITY_COLLECTOR_SOURCE_BY_ENV || '');
const DEFAULT_INCLUDE_CALIBRATION = parseBoolean(process.env.QUANTUM_ROLLOUT_SIGNOFF_INCLUDE_CALIBRATION, true);
const DEFAULT_FAIL_ON_BLOCKED = parseBoolean(process.env.QUANTUM_ROLLOUT_SIGNOFF_FAIL_ON_BLOCKED, false);
const DEFAULT_PERSIST_SIGNOFF = parseBoolean(process.env.QUANTUM_ROLLOUT_SIGNOFF_PERSIST_RESULTS, true);

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
    stale_seconds: 3600,
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
    stale_seconds: 1800,
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
    stale_seconds: 900,
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

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
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

function parseList(rawValue, fallback = []) {
  const text = String(rawValue || '').trim();
  if (!text) return fallback;
  return text
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeConfidence(value, fallback = 'medium') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['low', 'medium', 'high'].includes(normalized)) {
    return normalized;
  }
  return fallback;
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
  return `Usage:\n  node scripts/signoff_quantum_rollout_matrix.js [options]\n\nOptions:\n  --base-url <url>                  Backend base URL (default: ${DEFAULT_BASE_URL})\n  --environments <csv>              Environments to evaluate (default: ${DEFAULT_ENVIRONMENTS.join(',')})\n  --source <tag>                    Default reliability source tag\n  --source-by-env <csv>             Per-env source mapping (ex: dev:collector-dev,prod:collector-prod)\n  --report-file <path>              Output report JSON path\n  --output-dir <path>               Output directory when --report-file is omitted\n  --include-calibration <bool>      Include calibration endpoint details (default: ${String(DEFAULT_INCLUDE_CALIBRATION)})\n  --persist-signoff <bool>          Persist each env signoff via backend endpoint (default: ${String(DEFAULT_PERSIST_SIGNOFF)})\n  --fail-on-blocked <bool>          Exit non-zero when any env is blocked/error (default: ${String(DEFAULT_FAIL_ON_BLOCKED)})\n  --lookback-minutes <n>            Override lookback window for all environments\n  --bucket-seconds <n>              Override bucket size for all environments\n  --min-buckets <n>                 Override minimum buckets for all environments\n  --min-signal-buckets <n>          Override minimum signal buckets\n  --require-live-source <bool>      Override require_live_source policy\n  --min-live-signal-buckets <n>     Override minimum live signal buckets\n  --require-recent-samples <bool>   Override require_recent_samples policy\n  --max-sample-age-seconds <n>      Override max sample age policy\n  --stale-seconds <n>               Override stale threshold for source-status endpoint\n  --require-confidence <level>      low | medium | high\n  --allow-fallback-source <bool>    Override allow_fallback_source policy\n  --enforce-availability <bool>     Override enforce_availability policy\n  --require-persistence <bool>      Override require_persistence policy\n  --max-fallback-ratio-percent <n>  Override max fallback ratio policy\n  --help                            Show this help\n`;
}

async function fetchEndpoint(client, endpoint, params = {}) {
  const response = await client.get(endpoint, { params });
  if (response.status >= 400 || !response?.data?.success) {
    throw new Error(`${endpoint} failed (${response.status})`);
  }
  return response.data.data || {};
}

async function postEndpoint(client, endpoint, payload = {}) {
  const response = await client.post(endpoint, payload);
  if (response.status >= 400 || !response?.data?.success) {
    throw new Error(`${endpoint} failed (${response.status})`);
  }
  return response.data.data || {};
}

function buildReadinessQuery(args, defaults, source) {
  const query = {
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

  if (source) {
    query.source = source;
  }

  return query;
}

function buildSourceStatusQuery(args, defaults, readinessQuery, source) {
  const query = {
    window_minutes: readinessQuery.lookback_minutes,
    stale_seconds: toPositiveInt(
      args['stale-seconds'],
      defaults.stale_seconds || readinessQuery.max_sample_age_seconds,
      30,
      24 * 60 * 60
    ),
  };

  if (source) {
    query.source = source;
  }

  return query;
}

function buildCalibrationQuery(readinessQuery, source) {
  const query = {
    lookback_minutes: readinessQuery.lookback_minutes,
    bucket_seconds: readinessQuery.bucket_seconds,
    min_buckets: readinessQuery.min_buckets,
    include_windows: false,
  };

  if (source) {
    query.source = source;
  }

  return query;
}

function summarizeSourceStatus(status = {}) {
  const sources = Array.isArray(status?.sources) ? status.sources : [];
  const staleSources = sources.filter((source) => source?.stale).length;
  const staleProviders = sources.reduce((count, source) => {
    const providers = source?.providers && typeof source.providers === 'object'
      ? Object.values(source.providers)
      : [];
    return count + providers.filter((provider) => provider?.stale).length;
  }, 0);

  return {
    total_samples: Number(status?.total_samples || 0),
    total_sources: Number(status?.total_sources || 0),
    stale_sources: staleSources,
    stale_providers: staleProviders,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const baseUrl = String(args['base-url'] || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const outputDir = path.resolve(process.cwd(), String(args['output-dir'] || DEFAULT_OUTPUT_DIR));
  const environments = parseList(args.environments, DEFAULT_ENVIRONMENTS)
    .map((envName) => String(envName).trim().toLowerCase())
    .filter(Boolean);
  const defaultSource = normalizeSourceTag(args.source || DEFAULT_SOURCE);
  const sourceByEnv = {
    ...DEFAULT_SOURCE_BY_ENV,
    ...parseSourceByEnv(args['source-by-env']),
  };
  const includeCalibration = parseBoolean(args['include-calibration'], DEFAULT_INCLUDE_CALIBRATION);
  const persistSignoff = parseBoolean(args['persist-signoff'], DEFAULT_PERSIST_SIGNOFF);
  const failOnBlocked = parseBoolean(args['fail-on-blocked'], DEFAULT_FAIL_ON_BLOCKED);

  const client = axios.create({
    baseURL: baseUrl,
    timeout: 30000,
    validateStatus: (status) => status >= 200 && status < 500,
  });

  const results = [];
  for (const environment of environments) {
    const defaults = ENV_PROFILE_DEFAULTS[environment] || ENV_PROFILE_DEFAULTS.dev;
    const source = resolveSourceForEnvironment(environment, defaultSource, sourceByEnv);
    const readinessQuery = buildReadinessQuery(args, defaults, source);
    const sourceStatusQuery = buildSourceStatusQuery(args, defaults, readinessQuery, source);
    const calibrationQuery = buildCalibrationQuery(readinessQuery, source);

    try {
      const readiness = await fetchEndpoint(client, '/api/quantum/providers/reliability-rollout-readiness', readinessQuery);
      const sourceStatus = await fetchEndpoint(client, '/api/quantum/providers/reliability-source-status', sourceStatusQuery);
      const calibration = includeCalibration
        ? await fetchEndpoint(client, '/api/quantum/providers/reliability-calibration', calibrationQuery)
        : null;
      let persistedSignoff = null;
      let persistError = null;

      if (persistSignoff) {
        try {
          const persisted = await postEndpoint(client, '/api/quantum/providers/reliability-rollout-signoff', {
            environment,
            source: source || undefined,
            lookback_minutes: readinessQuery.lookback_minutes,
            bucket_seconds: readinessQuery.bucket_seconds,
            min_buckets: readinessQuery.min_buckets,
            min_signal_buckets: readinessQuery.min_signal_buckets,
            require_live_source: readinessQuery.require_live_source,
            min_live_signal_buckets: readinessQuery.min_live_signal_buckets,
            require_recent_samples: readinessQuery.require_recent_samples,
            max_sample_age_seconds: readinessQuery.max_sample_age_seconds,
            require_confidence: readinessQuery.require_confidence,
            allow_fallback_source: readinessQuery.allow_fallback_source,
            enforce_availability: readinessQuery.enforce_availability,
            require_persistence: readinessQuery.require_persistence,
            max_fallback_ratio_percent: readinessQuery.max_fallback_ratio_percent,
            include_calibration: includeCalibration,
            include_details: false,
          });
          persistedSignoff = persisted?.signoff
            ? {
              signoff_id: persisted.signoff.signoff_id,
              status: persisted.signoff.status,
              approved: persisted.signoff.approved,
              created_at: persisted.signoff.created_at,
            }
            : null;
        } catch (error) {
          persistError = String(error?.message || error);
        }
      }

      const approved = Boolean(readiness?.readiness?.approved);
      const blockerCodes = Array.isArray(readiness?.readiness?.blockers)
        ? readiness.readiness.blockers.map((blocker) => String(blocker?.code || 'unknown'))
        : [];

      const sourceSummary = summarizeSourceStatus(sourceStatus);
      results.push({
        environment,
        source: source || null,
        status: approved ? 'approved' : 'blocked',
        approved,
        readiness_status: String(readiness?.readiness?.status || (approved ? 'approved' : 'review_required')),
        confidence_level: String(readiness?.readiness?.confidence_level || 'unknown'),
        calibration_source: String(readiness?.readiness?.source || 'unknown'),
        blockers: blockerCodes,
        policy: readiness?.policy || {},
        source_status_summary: sourceSummary,
        source_status: sourceStatus,
        calibration: includeCalibration
          ? {
            confidence: calibration?.confidence || {},
            sample_counts: calibration?.sample_counts || {},
            recommendations_source: calibration?.recommendations?.source || 'unknown',
          }
          : null,
        persisted_signoff: persistedSignoff,
        persist_error: persistError,
        queries: {
          readiness: readinessQuery,
          source_status: sourceStatusQuery,
          calibration: includeCalibration ? calibrationQuery : null,
        },
      });

      process.stdout.write(
        `[signoff] env=${environment} approved=${approved} blockers=${blockerCodes.length} source_samples=${sourceSummary.total_samples} stale_sources=${sourceSummary.stale_sources} persisted=${persistedSignoff ? 'yes' : 'no'}${persistError ? ` persist_error=${persistError}` : ''}\n`
      );
    } catch (error) {
      results.push({
        environment,
        source: source || null,
        status: 'error',
        approved: false,
        error: String(error?.message || error),
        queries: {
          readiness: readinessQuery,
          source_status: sourceStatusQuery,
          calibration: includeCalibration ? calibrationQuery : null,
        },
      });
      process.stdout.write(`[signoff] env=${environment} status=error error=${String(error?.message || error)}\n`);
    }
  }

  const approvedCount = results.filter((item) => item.status === 'approved').length;
  const blockedCount = results.filter((item) => item.status === 'blocked').length;
  const errorCount = results.filter((item) => item.status === 'error').length;
  const summary = {
    total_environments: results.length,
    approved: approvedCount,
    blocked: blockedCount,
    errors: errorCount,
    status: (blockedCount === 0 && errorCount === 0) ? 'approved' : 'review_required',
  };

  const generatedAt = new Date();
  const defaultReportFile = path.join(
    outputDir,
    `rollout-signoff-${generatedAt.toISOString().replace(/[:.]/g, '-')}.json`
  );
  const reportFile = path.resolve(process.cwd(), String(args['report-file'] || defaultReportFile));

  const reportPayload = {
    generated_at: generatedAt.toISOString(),
    base_url: baseUrl,
    include_calibration: includeCalibration,
    persist_signoff: persistSignoff,
    fail_on_blocked: failOnBlocked,
    summary,
    results,
  };

  await fs.mkdir(path.dirname(reportFile), { recursive: true });
  await fs.writeFile(reportFile, `${JSON.stringify(reportPayload, null, 2)}\n`, 'utf8');

  process.stdout.write(`Signoff summary: approved=${approvedCount}, blocked=${blockedCount}, errors=${errorCount}\n`);
  process.stdout.write(`Report: ${reportFile}\n`);

  if (failOnBlocked && (blockedCount > 0 || errorCount > 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`Quantum rollout signoff failed: ${error.message}\n`);
  process.exit(1);
});
