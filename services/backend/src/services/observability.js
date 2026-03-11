function resolveObservabilityProfile(raw = process.env.OBS_ENV_PROFILE || process.env.NODE_ENV || 'dev') {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'production' || normalized === 'prod') return 'prod';
  if (normalized === 'staging' || normalized === 'stage' || normalized === 'preprod') return 'staging';
  if (normalized === 'test') return 'test';
  return 'dev';
}

const OBS_PROFILE_DEFAULTS = {
  dev: {
    alert_window_ms: 120_000,
    slo_window_ms: 1_800_000,
    max_http_samples: 4000,
    max_ws_samples: 2400,
    alerts: {
      http_error_rate_percent: 10,
      http_p95_ms: 1800,
      ws_drop_rate_percent: 6,
      ws_auth_failure_count: 60,
      ws_rate_limited_count: 120,
      ws_unauthorized_subscription_count: 60,
      ws_rejected_connection_count: 60,
    },
    slo_targets: {
      api_availability_percent: 98.5,
      api_p95_ms: 1200,
      ws_delivery_percent: 92,
      ws_drop_rate_percent: 4,
    },
    calibration: {
      lookback_ms: 30 * 60 * 1000,
      bucket_ms: 60 * 1000,
      min_buckets: 6,
    },
  },
  test: {
    alert_window_ms: 60_000,
    slo_window_ms: 60_000,
    max_http_samples: 1200,
    max_ws_samples: 1200,
    alerts: {
      http_error_rate_percent: 10,
      http_p95_ms: 1500,
      ws_drop_rate_percent: 8,
      ws_auth_failure_count: 100,
      ws_rate_limited_count: 100,
      ws_unauthorized_subscription_count: 100,
      ws_rejected_connection_count: 100,
    },
    slo_targets: {
      api_availability_percent: 95,
      api_p95_ms: 1500,
      ws_delivery_percent: 90,
      ws_drop_rate_percent: 8,
    },
    calibration: {
      lookback_ms: 10 * 60 * 1000,
      bucket_ms: 30 * 1000,
      min_buckets: 3,
    },
  },
  staging: {
    alert_window_ms: 180_000,
    slo_window_ms: 3_600_000,
    max_http_samples: 6000,
    max_ws_samples: 5000,
    alerts: {
      http_error_rate_percent: 7,
      http_p95_ms: 1400,
      ws_drop_rate_percent: 3,
      ws_auth_failure_count: 35,
      ws_rate_limited_count: 60,
      ws_unauthorized_subscription_count: 35,
      ws_rejected_connection_count: 35,
    },
    slo_targets: {
      api_availability_percent: 99.2,
      api_p95_ms: 900,
      ws_delivery_percent: 94,
      ws_drop_rate_percent: 2.5,
    },
    calibration: {
      lookback_ms: 45 * 60 * 1000,
      bucket_ms: 60 * 1000,
      min_buckets: 8,
    },
  },
  prod: {
    alert_window_ms: 300_000,
    slo_window_ms: 3_600_000,
    max_http_samples: 8000,
    max_ws_samples: 6000,
    alerts: {
      http_error_rate_percent: 5,
      http_p95_ms: 1200,
      ws_drop_rate_percent: 2,
      ws_auth_failure_count: 20,
      ws_rate_limited_count: 40,
      ws_unauthorized_subscription_count: 20,
      ws_rejected_connection_count: 20,
    },
    slo_targets: {
      api_availability_percent: 99.5,
      api_p95_ms: 800,
      ws_delivery_percent: 95,
      ws_drop_rate_percent: 2,
    },
    calibration: {
      lookback_ms: 60 * 60 * 1000,
      bucket_ms: 60 * 1000,
      min_buckets: 10,
    },
  },
};

const OBS_PROFILE = resolveObservabilityProfile();
const OBS_PROFILE_SETTINGS = OBS_PROFILE_DEFAULTS[OBS_PROFILE] || OBS_PROFILE_DEFAULTS.dev;

function resolveNumericEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

const ALERT_WINDOW_MS = resolveNumericEnv('OBS_ALERT_WINDOW_MS', OBS_PROFILE_SETTINGS.alert_window_ms);
const SLO_WINDOW_MS = resolveNumericEnv('OBS_SLO_WINDOW_MS', OBS_PROFILE_SETTINGS.slo_window_ms);
const MAX_HTTP_SAMPLES = Math.max(200, resolveNumericEnv('OBS_MAX_HTTP_SAMPLES', OBS_PROFILE_SETTINGS.max_http_samples));
const CALIBRATION_LOOKBACK_MS = Math.max(
  60_000,
  resolveNumericEnv('OBS_CALIBRATION_LOOKBACK_MS', OBS_PROFILE_SETTINGS.calibration.lookback_ms)
);
const CALIBRATION_BUCKET_MS = Math.max(
  10_000,
  resolveNumericEnv('OBS_CALIBRATION_BUCKET_MS', OBS_PROFILE_SETTINGS.calibration.bucket_ms)
);
const CALIBRATION_MIN_BUCKETS = Math.max(
  2,
  resolveNumericEnv('OBS_CALIBRATION_MIN_BUCKETS', OBS_PROFILE_SETTINGS.calibration.min_buckets)
);

const ALERT_HTTP_ERROR_RATE_PERCENT = resolveNumericEnv(
  'ALERT_HTTP_ERROR_RATE_PERCENT',
  OBS_PROFILE_SETTINGS.alerts.http_error_rate_percent
);
const ALERT_HTTP_P95_MS = resolveNumericEnv('ALERT_HTTP_P95_MS', OBS_PROFILE_SETTINGS.alerts.http_p95_ms);
const ALERT_WS_DROP_RATE_PERCENT = resolveNumericEnv(
  'ALERT_WS_DROP_RATE_PERCENT',
  OBS_PROFILE_SETTINGS.alerts.ws_drop_rate_percent
);
const ALERT_WS_AUTH_FAILURE_COUNT = resolveNumericEnv(
  'ALERT_WS_AUTH_FAILURE_COUNT',
  OBS_PROFILE_SETTINGS.alerts.ws_auth_failure_count
);
const ALERT_WS_RATE_LIMITED_COUNT = resolveNumericEnv(
  'ALERT_WS_RATE_LIMITED_COUNT',
  OBS_PROFILE_SETTINGS.alerts.ws_rate_limited_count
);
const ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT = resolveNumericEnv(
  'ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT',
  OBS_PROFILE_SETTINGS.alerts.ws_unauthorized_subscription_count
);
const ALERT_WS_REJECTED_CONNECTION_COUNT = resolveNumericEnv(
  'ALERT_WS_REJECTED_CONNECTION_COUNT',
  OBS_PROFILE_SETTINGS.alerts.ws_rejected_connection_count
);

const SLO_API_AVAILABILITY_TARGET = resolveNumericEnv(
  'SLO_API_AVAILABILITY_TARGET',
  OBS_PROFILE_SETTINGS.slo_targets.api_availability_percent
);
const SLO_API_P95_MS_TARGET = resolveNumericEnv('SLO_API_P95_MS_TARGET', OBS_PROFILE_SETTINGS.slo_targets.api_p95_ms);
const SLO_WS_DELIVERY_TARGET = resolveNumericEnv(
  'SLO_WS_DELIVERY_TARGET',
  OBS_PROFILE_SETTINGS.slo_targets.ws_delivery_percent
);
const SLO_WS_DROP_RATE_TARGET = resolveNumericEnv(
  'SLO_WS_DROP_RATE_TARGET',
  OBS_PROFILE_SETTINGS.slo_targets.ws_drop_rate_percent
);

const BOOT_TS = Date.now();

const httpRequestCounters = new Map();
const httpRequestSamples = [];
const wsCounterSamples = [];
const MAX_WS_SAMPLES = Math.max(120, resolveNumericEnv('OBS_MAX_WS_SAMPLES', OBS_PROFILE_SETTINGS.max_ws_samples));

function nowTs() {
  return Date.now();
}

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampNumber(value, minValue, maxValue) {
  return Math.min(Math.max(value, minValue), maxValue);
}

function roundNumber(value, digits = 2) {
  const precision = Math.max(0, Math.min(6, toSafeNumber(digits, 0)));
  const factor = 10 ** precision;
  return Math.round(toSafeNumber(value, 0) * factor) / factor;
}

function sanitizeRoute(pathValue = '') {
  const raw = String(pathValue || '').trim();
  if (!raw) return '/unknown';
  return raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function statusClass(statusCode) {
  const status = toSafeNumber(statusCode, 0);
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return 'other';
}

function normalizeMethod(methodValue) {
  return String(methodValue || 'GET').toUpperCase();
}

function keyForCounter({ method, route, statusClassValue }) {
  return `${method}|${route}|${statusClassValue}`;
}

function evictOldHttpSamples() {
  const oldestAllowedTs = nowTs() - Math.max(ALERT_WINDOW_MS, SLO_WINDOW_MS) - 10_000;
  while (httpRequestSamples.length > 0 && httpRequestSamples[0].ts < oldestAllowedTs) {
    httpRequestSamples.shift();
  }
  while (httpRequestSamples.length > MAX_HTTP_SAMPLES) {
    httpRequestSamples.shift();
  }
}

function recordHttpRequestMetric({
  method,
  route,
  path,
  statusCode,
  durationMs,
}) {
  const normalizedMethod = normalizeMethod(method);
  const normalizedRoute = sanitizeRoute(route || path || '/unknown');
  const classValue = statusClass(statusCode);
  const counterKey = keyForCounter({
    method: normalizedMethod,
    route: normalizedRoute,
    statusClassValue: classValue,
  });

  const current = httpRequestCounters.get(counterKey) || {
    method: normalizedMethod,
    route: normalizedRoute,
    status_class: classValue,
    count: 0,
  };
  current.count += 1;
  httpRequestCounters.set(counterKey, current);

  httpRequestSamples.push({
    ts: nowTs(),
    method: normalizedMethod,
    route: normalizedRoute,
    status_code: toSafeNumber(statusCode, 0),
    duration_ms: toSafeNumber(durationMs, 0),
  });
  evictOldHttpSamples();
}

function percentile(values = [], p = 95) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

function getHttpSamples(windowMs = SLO_WINDOW_MS) {
  const minTs = nowTs() - Math.max(1000, windowMs);
  return httpRequestSamples.filter((sample) => sample.ts >= minTs);
}

function summarizeHttp(windowMs = SLO_WINDOW_MS) {
  const samples = getHttpSamples(windowMs);
  const total = samples.length;
  const errors = samples.filter((sample) => sample.status_code >= 500).length;
  const p95 = percentile(samples.map((sample) => sample.duration_ms), 95);
  const p99 = percentile(samples.map((sample) => sample.duration_ms), 99);
  const avg = total > 0
    ? samples.reduce((sum, sample) => sum + sample.duration_ms, 0) / total
    : 0;

  return {
    window_ms: windowMs,
    requests_total: total,
    errors_5xx: errors,
    availability_percent: total > 0 ? Number(((1 - (errors / total)) * 100).toFixed(4)) : 100,
    error_rate_percent: total > 0 ? Number(((errors / total) * 100).toFixed(4)) : 0,
    latency_ms: {
      avg: Number(avg.toFixed(4)),
      p95: Number(p95.toFixed(4)),
      p99: Number(p99.toFixed(4)),
    },
  };
}

function getCounterSnapshot() {
  return [...httpRequestCounters.values()]
    .map((entry) => ({
      method: entry.method,
      route: entry.route,
      status_class: entry.status_class,
      count: entry.count,
    }))
    .sort((a, b) => b.count - a.count);
}

function snapshotWsCounters(streamStatus = {}, ts = nowTs()) {
  return {
    ts,
    published_events: toSafeNumber(streamStatus.published_events, 0),
    delivered_messages: toSafeNumber(streamStatus.delivered_messages, 0),
    dropped_messages: toSafeNumber(streamStatus.dropped_messages, 0),
    rate_limited_messages: toSafeNumber(streamStatus.rate_limited_messages, 0),
    auth_failures: toSafeNumber(streamStatus.auth_failures, 0),
    unauthorized_subscriptions: toSafeNumber(streamStatus.unauthorized_subscriptions, 0),
    rejected_connections: toSafeNumber(streamStatus.rejected_connections, 0),
  };
}

function evictOldWsSamples() {
  const oldestAllowedTs = nowTs() - Math.max(ALERT_WINDOW_MS, SLO_WINDOW_MS) - 10_000;
  while (wsCounterSamples.length > 0 && wsCounterSamples[0].ts < oldestAllowedTs) {
    wsCounterSamples.shift();
  }
  while (wsCounterSamples.length > MAX_WS_SAMPLES) {
    wsCounterSamples.shift();
  }
}

function recordWsSample(streamStatus = {}) {
  const sample = snapshotWsCounters(streamStatus);
  const last = wsCounterSamples[wsCounterSamples.length - 1];
  if (
    last
    && sample.published_events === last.published_events
    && sample.delivered_messages === last.delivered_messages
    && sample.dropped_messages === last.dropped_messages
    && sample.rate_limited_messages === last.rate_limited_messages
    && sample.auth_failures === last.auth_failures
    && sample.unauthorized_subscriptions === last.unauthorized_subscriptions
    && sample.rejected_connections === last.rejected_connections
    && (sample.ts - last.ts) < 250
  ) {
    return last;
  }

  wsCounterSamples.push(sample);
  evictOldWsSamples();
  return sample;
}

function getWsSamples(windowMs = ALERT_WINDOW_MS, streamStatus = {}) {
  const current = recordWsSample(streamStatus);
  const minTs = nowTs() - Math.max(1000, windowMs);
  const windowSamples = wsCounterSamples.filter((sample) => sample.ts >= minTs);

  if (windowSamples.length === 0) {
    return [current];
  }
  return windowSamples;
}

function computeCounterDelta(samples = [], key) {
  if (!Array.isArray(samples) || samples.length <= 1) {
    return 0;
  }
  const first = toSafeNumber(samples[0]?.[key], 0);
  const last = toSafeNumber(samples[samples.length - 1]?.[key], 0);
  return Math.max(0, last - first);
}

function summarizeWsWindow(streamStatus = {}, windowMs = ALERT_WINDOW_MS) {
  const samples = getWsSamples(windowMs, streamStatus);
  const counters = {
    published_events: computeCounterDelta(samples, 'published_events'),
    delivered_messages: computeCounterDelta(samples, 'delivered_messages'),
    dropped_messages: computeCounterDelta(samples, 'dropped_messages'),
    rate_limited_messages: computeCounterDelta(samples, 'rate_limited_messages'),
    auth_failures: computeCounterDelta(samples, 'auth_failures'),
    unauthorized_subscriptions: computeCounterDelta(samples, 'unauthorized_subscriptions'),
    rejected_connections: computeCounterDelta(samples, 'rejected_connections'),
  };

  const deliveryRatio = counters.published_events > 0
    ? Number((Math.max(0, Math.min(1, counters.delivered_messages / counters.published_events)) * 100).toFixed(4))
    : 100;
  const dropRate = (counters.dropped_messages + counters.delivered_messages) > 0
    ? Number(((counters.dropped_messages / (counters.dropped_messages + counters.delivered_messages)) * 100).toFixed(4))
    : 0;

  return {
    window_ms: windowMs,
    samples: samples.length,
    counters,
    delivery_ratio_percent: deliveryRatio,
    drop_rate_percent: dropRate,
  };
}

function buildHttpBucketSummaries(windowMs, bucketMs) {
  const minTs = nowTs() - Math.max(1_000, windowMs);
  const normalizedBucketMs = Math.max(10_000, bucketMs);
  const bucketMap = new Map();

  httpRequestSamples
    .filter((sample) => sample.ts >= minTs)
    .forEach((sample) => {
      const bucketTs = Math.floor(sample.ts / normalizedBucketMs) * normalizedBucketMs;
      const current = bucketMap.get(bucketTs) || {
        bucket_start_ts: bucketTs,
        bucket_end_ts: bucketTs + normalizedBucketMs,
        requests_total: 0,
        errors_5xx: 0,
        durations: [],
      };
      current.requests_total += 1;
      if (sample.status_code >= 500) {
        current.errors_5xx += 1;
      }
      current.durations.push(toSafeNumber(sample.duration_ms, 0));
      bucketMap.set(bucketTs, current);
    });

  return [...bucketMap.values()]
    .sort((a, b) => a.bucket_start_ts - b.bucket_start_ts)
    .map((bucket) => {
      const avgMs = bucket.requests_total > 0
        ? bucket.durations.reduce((sum, value) => sum + value, 0) / bucket.requests_total
        : 0;
      const p95Ms = percentile(bucket.durations, 95);
      const p99Ms = percentile(bucket.durations, 99);
      const errorRatePercent = bucket.requests_total > 0
        ? (bucket.errors_5xx / bucket.requests_total) * 100
        : 0;
      const availabilityPercent = bucket.requests_total > 0
        ? (1 - (bucket.errors_5xx / bucket.requests_total)) * 100
        : 100;

      return {
        bucket_start_ts: bucket.bucket_start_ts,
        bucket_end_ts: bucket.bucket_end_ts,
        requests_total: bucket.requests_total,
        errors_5xx: bucket.errors_5xx,
        error_rate_percent: roundNumber(errorRatePercent, 4),
        availability_percent: roundNumber(availabilityPercent, 4),
        latency_ms: {
          avg: roundNumber(avgMs, 4),
          p95: roundNumber(p95Ms, 4),
          p99: roundNumber(p99Ms, 4),
        },
      };
    });
}

function buildWsBucketSummaries(streamStatus = {}, windowMs, bucketMs) {
  const current = recordWsSample(streamStatus);
  const minTs = nowTs() - Math.max(1_000, windowMs);
  const normalizedBucketMs = Math.max(10_000, bucketMs);

  const baseline = [...wsCounterSamples]
    .reverse()
    .find((sample) => sample.ts < minTs) || null;
  const windowSamples = wsCounterSamples.filter((sample) => sample.ts >= minTs);
  const samples = [];

  if (baseline) {
    samples.push(baseline);
  }
  samples.push(...windowSamples);

  if (!samples.some((sample) => sample.ts === current.ts)) {
    samples.push(current);
  }

  const countersByBucket = new Map();
  const counterKeys = [
    'published_events',
    'delivered_messages',
    'dropped_messages',
    'rate_limited_messages',
    'auth_failures',
    'unauthorized_subscriptions',
    'rejected_connections',
  ];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const currentSample = samples[index];
    if (!previous || !currentSample || currentSample.ts <= previous.ts || currentSample.ts < minTs) {
      continue;
    }

    const bucketTs = Math.floor(currentSample.ts / normalizedBucketMs) * normalizedBucketMs;
    const bucket = countersByBucket.get(bucketTs) || {
      bucket_start_ts: bucketTs,
      bucket_end_ts: bucketTs + normalizedBucketMs,
      counters: {
        published_events: 0,
        delivered_messages: 0,
        dropped_messages: 0,
        rate_limited_messages: 0,
        auth_failures: 0,
        unauthorized_subscriptions: 0,
        rejected_connections: 0,
      },
    };

    counterKeys.forEach((key) => {
      const delta = Math.max(
        0,
        toSafeNumber(currentSample[key], 0) - toSafeNumber(previous[key], 0)
      );
      bucket.counters[key] += delta;
    });

    countersByBucket.set(bucketTs, bucket);
  }

  return [...countersByBucket.values()]
    .sort((a, b) => a.bucket_start_ts - b.bucket_start_ts)
    .map((bucket) => {
      const deliveryRatio = bucket.counters.published_events > 0
        ? Math.max(
          0,
          Math.min(100, (bucket.counters.delivered_messages / bucket.counters.published_events) * 100)
        )
        : 100;
      const dropRateBase = bucket.counters.dropped_messages + bucket.counters.delivered_messages;
      const dropRate = dropRateBase > 0
        ? (bucket.counters.dropped_messages / dropRateBase) * 100
        : 0;

      return {
        ...bucket,
        delivery_ratio_percent: roundNumber(deliveryRatio, 4),
        drop_rate_percent: roundNumber(dropRate, 4),
      };
    });
}

function summarizeSeries(values = []) {
  const numericValues = (Array.isArray(values) ? values : [])
    .map((value) => toSafeNumber(value, NaN))
    .filter((value) => Number.isFinite(value));

  if (numericValues.length === 0) {
    return {
      count: 0,
      min: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      max: 0,
      avg: 0,
    };
  }

  const minValue = Math.min(...numericValues);
  const maxValue = Math.max(...numericValues);
  const avgValue = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;

  return {
    count: numericValues.length,
    min: roundNumber(minValue, 4),
    p50: roundNumber(percentile(numericValues, 50), 4),
    p90: roundNumber(percentile(numericValues, 90), 4),
    p95: roundNumber(percentile(numericValues, 95), 4),
    p99: roundNumber(percentile(numericValues, 99), 4),
    max: roundNumber(maxValue, 4),
    avg: roundNumber(avgValue, 4),
  };
}

function calibrationConfidence({
  minBuckets = CALIBRATION_MIN_BUCKETS,
  httpBuckets = 0,
  wsBuckets = 0,
}) {
  const weakest = Math.min(httpBuckets, wsBuckets);
  if (weakest >= minBuckets) {
    return {
      level: 'high',
      reason: 'Sustained traffic windows available for HTTP and WS.',
    };
  }
  if (weakest >= Math.max(2, Math.ceil(minBuckets / 2))) {
    return {
      level: 'medium',
      reason: 'Partial sustained windows available; recommendations are directional.',
    };
  }
  return {
    level: 'low',
    reason: 'Insufficient sustained windows; keep current thresholds and collect more traffic.',
  };
}

function calibrateObservabilityThresholds(streamStatus = {}, options = {}) {
  const lookbackMsRaw = Number(options.lookback_ms);
  const lookbackMinutesRaw = Number(options.lookback_minutes);
  const bucketMsRaw = Number(options.bucket_ms);
  const bucketSecondsRaw = Number(options.bucket_seconds);
  const minBucketsRaw = Number(options.min_buckets);
  const includeWindows = Boolean(options.include_windows);

  const lookbackMs = clampNumber(
    Number.isFinite(lookbackMsRaw)
      ? lookbackMsRaw
      : (Number.isFinite(lookbackMinutesRaw) ? lookbackMinutesRaw * 60_000 : CALIBRATION_LOOKBACK_MS),
    60_000,
    24 * 60 * 60 * 1000
  );
  const bucketMs = clampNumber(
    Number.isFinite(bucketMsRaw)
      ? bucketMsRaw
      : (Number.isFinite(bucketSecondsRaw) ? bucketSecondsRaw * 1000 : CALIBRATION_BUCKET_MS),
    10_000,
    Math.max(10_000, Math.floor(lookbackMs / 2))
  );
  const minBuckets = clampNumber(
    Number.isFinite(minBucketsRaw) ? minBucketsRaw : CALIBRATION_MIN_BUCKETS,
    2,
    240
  );

  const httpBuckets = buildHttpBucketSummaries(lookbackMs, bucketMs);
  const wsBuckets = buildWsBucketSummaries(streamStatus, lookbackMs, bucketMs);
  const minHttpRequestsPerBucket = Math.max(
    3,
    clampNumber(toSafeNumber(options.min_http_requests_per_bucket, 8), 1, 100)
  );

  const httpSignalBuckets = httpBuckets.filter((bucket) => bucket.requests_total >= minHttpRequestsPerBucket);
  const wsSignalBuckets = wsBuckets.filter((bucket) => {
    const c = bucket.counters || {};
    return (c.published_events + c.delivered_messages + c.dropped_messages) > 0;
  });

  const httpErrorSeries = httpSignalBuckets.map((bucket) => bucket.error_rate_percent);
  const httpLatencyP95Series = httpSignalBuckets.map((bucket) => bucket.latency_ms.p95);
  const httpAvailabilitySeries = httpSignalBuckets.map((bucket) => bucket.availability_percent);

  const wsDropSeries = wsSignalBuckets.map((bucket) => bucket.drop_rate_percent);
  const wsDeliverySeries = wsSignalBuckets.map((bucket) => bucket.delivery_ratio_percent);
  const wsAuthFailureSeries = wsBuckets.map((bucket) => toSafeNumber(bucket.counters.auth_failures, 0));
  const wsRateLimitedSeries = wsBuckets.map((bucket) => toSafeNumber(bucket.counters.rate_limited_messages, 0));
  const wsUnauthorizedSeries = wsBuckets.map((bucket) => toSafeNumber(bucket.counters.unauthorized_subscriptions, 0));
  const wsRejectedSeries = wsBuckets.map((bucket) => toSafeNumber(bucket.counters.rejected_connections, 0));

  const confidence = calibrationConfidence({
    minBuckets,
    httpBuckets: httpSignalBuckets.length,
    wsBuckets: wsSignalBuckets.length,
  });
  const hasTrafficCalibration = confidence.level !== 'low';

  const recommendedAlerts = {
    http_error_rate_percent: hasTrafficCalibration && httpErrorSeries.length > 0
      ? roundNumber(clampNumber(percentile(httpErrorSeries, 95) * 1.35, 0.1, 100), 4)
      : ALERT_HTTP_ERROR_RATE_PERCENT,
    http_p95_ms: hasTrafficCalibration && httpLatencyP95Series.length > 0
      ? Math.round(clampNumber(percentile(httpLatencyP95Series, 95) * 1.15, 50, 20_000))
      : ALERT_HTTP_P95_MS,
    ws_drop_rate_percent: hasTrafficCalibration && wsDropSeries.length > 0
      ? roundNumber(clampNumber(percentile(wsDropSeries, 95) * 1.25, 0.1, 100), 4)
      : ALERT_WS_DROP_RATE_PERCENT,
    ws_auth_failure_count: hasTrafficCalibration && wsAuthFailureSeries.length > 0
      ? Math.ceil(clampNumber(percentile(wsAuthFailureSeries, 95) * 1.2, 1, 20_000))
      : ALERT_WS_AUTH_FAILURE_COUNT,
    ws_rate_limited_count: hasTrafficCalibration && wsRateLimitedSeries.length > 0
      ? Math.ceil(clampNumber(percentile(wsRateLimitedSeries, 95) * 1.2, 1, 20_000))
      : ALERT_WS_RATE_LIMITED_COUNT,
    ws_unauthorized_subscription_count: hasTrafficCalibration && wsUnauthorizedSeries.length > 0
      ? Math.ceil(clampNumber(percentile(wsUnauthorizedSeries, 95) * 1.2, 1, 20_000))
      : ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT,
    ws_rejected_connection_count: hasTrafficCalibration && wsRejectedSeries.length > 0
      ? Math.ceil(clampNumber(percentile(wsRejectedSeries, 95) * 1.2, 1, 20_000))
      : ALERT_WS_REJECTED_CONNECTION_COUNT,
  };

  const recommendedSloTargets = {
    api_availability_percent: hasTrafficCalibration && httpAvailabilitySeries.length > 0
      ? roundNumber(clampNumber(percentile(httpAvailabilitySeries, 20) - 0.2, 90, 99.9999), 4)
      : SLO_API_AVAILABILITY_TARGET,
    api_p95_ms: hasTrafficCalibration && httpLatencyP95Series.length > 0
      ? Math.round(clampNumber(percentile(httpLatencyP95Series, 75) * 1.08, 50, 20_000))
      : SLO_API_P95_MS_TARGET,
    ws_delivery_percent: hasTrafficCalibration && wsDeliverySeries.length > 0
      ? roundNumber(clampNumber(percentile(wsDeliverySeries, 20) - 0.5, 70, 100), 4)
      : SLO_WS_DELIVERY_TARGET,
    ws_drop_rate_percent: hasTrafficCalibration && wsDropSeries.length > 0
      ? roundNumber(clampNumber(percentile(wsDropSeries, 80) * 1.08, 0.05, 100), 4)
      : SLO_WS_DROP_RATE_TARGET,
  };

  return {
    generated_at: new Date().toISOString(),
    profile: OBS_PROFILE,
    windows: {
      lookback_ms: lookbackMs,
      bucket_ms: bucketMs,
      min_buckets: minBuckets,
      min_http_requests_per_bucket: minHttpRequestsPerBucket,
    },
    sample_counts: {
      http_samples: getHttpSamples(lookbackMs).length,
      ws_samples: wsCounterSamples.filter((sample) => sample.ts >= (nowTs() - lookbackMs)).length,
      http_buckets: httpBuckets.length,
      ws_buckets: wsBuckets.length,
      http_signal_buckets: httpSignalBuckets.length,
      ws_signal_buckets: wsSignalBuckets.length,
    },
    confidence,
    baseline: {
      http: {
        error_rate_percent: summarizeSeries(httpErrorSeries),
        latency_p95_ms: summarizeSeries(httpLatencyP95Series),
        availability_percent: summarizeSeries(httpAvailabilitySeries),
      },
      ws: {
        drop_rate_percent: summarizeSeries(wsDropSeries),
        delivery_ratio_percent: summarizeSeries(wsDeliverySeries),
        auth_failures_per_bucket: summarizeSeries(wsAuthFailureSeries),
        rate_limited_per_bucket: summarizeSeries(wsRateLimitedSeries),
        unauthorized_subscriptions_per_bucket: summarizeSeries(wsUnauthorizedSeries),
        rejected_connections_per_bucket: summarizeSeries(wsRejectedSeries),
      },
    },
    current: {
      alerts: {
        http_error_rate_percent: ALERT_HTTP_ERROR_RATE_PERCENT,
        http_p95_ms: ALERT_HTTP_P95_MS,
        ws_drop_rate_percent: ALERT_WS_DROP_RATE_PERCENT,
        ws_auth_failure_count: ALERT_WS_AUTH_FAILURE_COUNT,
        ws_rate_limited_count: ALERT_WS_RATE_LIMITED_COUNT,
        ws_unauthorized_subscription_count: ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT,
        ws_rejected_connection_count: ALERT_WS_REJECTED_CONNECTION_COUNT,
      },
      slo_targets: {
        api_availability_percent: SLO_API_AVAILABILITY_TARGET,
        api_p95_ms: SLO_API_P95_MS_TARGET,
        ws_delivery_percent: SLO_WS_DELIVERY_TARGET,
        ws_drop_rate_percent: SLO_WS_DROP_RATE_TARGET,
      },
    },
    recommendations: {
      alerts: recommendedAlerts,
      slo_targets: recommendedSloTargets,
      env_overrides: {
        ALERT_HTTP_ERROR_RATE_PERCENT: recommendedAlerts.http_error_rate_percent,
        ALERT_HTTP_P95_MS: recommendedAlerts.http_p95_ms,
        ALERT_WS_DROP_RATE_PERCENT: recommendedAlerts.ws_drop_rate_percent,
        ALERT_WS_AUTH_FAILURE_COUNT: recommendedAlerts.ws_auth_failure_count,
        ALERT_WS_RATE_LIMITED_COUNT: recommendedAlerts.ws_rate_limited_count,
        ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT: recommendedAlerts.ws_unauthorized_subscription_count,
        ALERT_WS_REJECTED_CONNECTION_COUNT: recommendedAlerts.ws_rejected_connection_count,
        SLO_API_AVAILABILITY_TARGET: recommendedSloTargets.api_availability_percent,
        SLO_API_P95_MS_TARGET: recommendedSloTargets.api_p95_ms,
        SLO_WS_DELIVERY_TARGET: recommendedSloTargets.ws_delivery_percent,
        SLO_WS_DROP_RATE_TARGET: recommendedSloTargets.ws_drop_rate_percent,
      },
      source: hasTrafficCalibration ? 'traffic_window_calibration' : 'current_threshold_fallback',
    },
    notes: hasTrafficCalibration
      ? [
        'Recommendations are computed from sustained bucketed traffic windows.',
        'Review and promote env overrides per environment after replay validation.',
      ]
      : [
        'Not enough sustained windows for robust calibration.',
        'Run load replay and re-check /api/system/observability/calibration.',
      ],
    windows_detail: includeWindows
      ? {
        http: httpBuckets,
        ws: wsBuckets,
      }
      : null,
  };
}

function computeStreamDeliveryRatio(streamStatus = {}) {
  const published = toSafeNumber(streamStatus.published_events, 0);
  if (published <= 0) return 100;
  const delivered = toSafeNumber(streamStatus.delivered_messages, 0);
  return Number((Math.max(0, Math.min(1, delivered / published)) * 100).toFixed(4));
}

function computeStreamDropRate(streamStatus = {}) {
  const dropped = toSafeNumber(streamStatus.dropped_messages, 0);
  const delivered = toSafeNumber(streamStatus.delivered_messages, 0);
  const total = dropped + delivered;
  if (total <= 0) return 0;
  return Number(((dropped / total) * 100).toFixed(4));
}

function evaluateAlerts(streamStatus = {}) {
  const httpSummary = summarizeHttp(ALERT_WINDOW_MS);
  const wsWindow = summarizeWsWindow(streamStatus, ALERT_WINDOW_MS);
  const alerts = [];

  if (httpSummary.error_rate_percent > ALERT_HTTP_ERROR_RATE_PERCENT) {
    alerts.push({
      key: 'api_error_rate_high',
      severity: 'critical',
      message: `5xx rate ${httpSummary.error_rate_percent}% exceeds ${ALERT_HTTP_ERROR_RATE_PERCENT}%`,
      value: httpSummary.error_rate_percent,
      threshold: ALERT_HTTP_ERROR_RATE_PERCENT,
    });
  }
  if (httpSummary.latency_ms.p95 > ALERT_HTTP_P95_MS) {
    alerts.push({
      key: 'api_latency_p95_high',
      severity: 'warning',
      message: `API p95 ${httpSummary.latency_ms.p95}ms exceeds ${ALERT_HTTP_P95_MS}ms`,
      value: httpSummary.latency_ms.p95,
      threshold: ALERT_HTTP_P95_MS,
    });
  }

  const wsDropRate = wsWindow.drop_rate_percent;
  if (wsDropRate > ALERT_WS_DROP_RATE_PERCENT) {
    alerts.push({
      key: 'ws_drop_rate_high',
      severity: 'critical',
      message: `WS drop rate ${wsDropRate}% exceeds ${ALERT_WS_DROP_RATE_PERCENT}%`,
      value: wsDropRate,
      threshold: ALERT_WS_DROP_RATE_PERCENT,
    });
  }
  const wsAuthFailures = wsWindow.counters.auth_failures;
  if (wsAuthFailures > ALERT_WS_AUTH_FAILURE_COUNT) {
    alerts.push({
      key: 'ws_auth_failures_high',
      severity: 'warning',
      message: `WS auth failures ${wsAuthFailures} exceed ${ALERT_WS_AUTH_FAILURE_COUNT}`,
      value: wsAuthFailures,
      threshold: ALERT_WS_AUTH_FAILURE_COUNT,
    });
  }
  if (wsWindow.counters.rate_limited_messages > ALERT_WS_RATE_LIMITED_COUNT) {
    alerts.push({
      key: 'ws_rate_limited_high',
      severity: 'warning',
      message: `WS rate-limited messages ${wsWindow.counters.rate_limited_messages} exceed ${ALERT_WS_RATE_LIMITED_COUNT}`,
      value: wsWindow.counters.rate_limited_messages,
      threshold: ALERT_WS_RATE_LIMITED_COUNT,
    });
  }
  if (wsWindow.counters.unauthorized_subscriptions > ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT) {
    alerts.push({
      key: 'ws_unauthorized_subscriptions_high',
      severity: 'warning',
      message: `WS unauthorized subscriptions ${wsWindow.counters.unauthorized_subscriptions} exceed ${ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT}`,
      value: wsWindow.counters.unauthorized_subscriptions,
      threshold: ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT,
    });
  }
  if (wsWindow.counters.rejected_connections > ALERT_WS_REJECTED_CONNECTION_COUNT) {
    alerts.push({
      key: 'ws_rejected_connections_high',
      severity: 'warning',
      message: `WS rejected connections ${wsWindow.counters.rejected_connections} exceed ${ALERT_WS_REJECTED_CONNECTION_COUNT}`,
      value: wsWindow.counters.rejected_connections,
      threshold: ALERT_WS_REJECTED_CONNECTION_COUNT,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    window_ms: ALERT_WINDOW_MS,
    active_alerts: alerts,
    status: alerts.length === 0 ? 'ok' : 'firing',
    http: httpSummary,
    ws: {
      delivery_ratio_percent: computeStreamDeliveryRatio(streamStatus),
      drop_rate_percent: wsDropRate,
      current_totals: {
        published_events: toSafeNumber(streamStatus.published_events, 0),
        delivered_messages: toSafeNumber(streamStatus.delivered_messages, 0),
        dropped_messages: toSafeNumber(streamStatus.dropped_messages, 0),
        rate_limited_messages: toSafeNumber(streamStatus.rate_limited_messages, 0),
        auth_failures: toSafeNumber(streamStatus.auth_failures, 0),
        unauthorized_subscriptions: toSafeNumber(streamStatus.unauthorized_subscriptions, 0),
        rejected_connections: toSafeNumber(streamStatus.rejected_connections, 0),
      },
      window_counters: wsWindow.counters,
      thresholds: {
        drop_rate_percent: ALERT_WS_DROP_RATE_PERCENT,
        auth_failures: ALERT_WS_AUTH_FAILURE_COUNT,
        rate_limited_messages: ALERT_WS_RATE_LIMITED_COUNT,
        unauthorized_subscriptions: ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT,
        rejected_connections: ALERT_WS_REJECTED_CONNECTION_COUNT,
      },
    },
  };
}

function evaluateSlo(streamStatus = {}) {
  const httpSummary = summarizeHttp(SLO_WINDOW_MS);
  const wsWindow = summarizeWsWindow(streamStatus, SLO_WINDOW_MS);
  const streamDelivery = wsWindow.delivery_ratio_percent;
  const wsDropRate = wsWindow.drop_rate_percent;

  const objectives = [
    {
      key: 'api_availability',
      description: 'API availability over rolling window',
      target_percent: SLO_API_AVAILABILITY_TARGET,
      actual_percent: httpSummary.availability_percent,
      met: httpSummary.availability_percent >= SLO_API_AVAILABILITY_TARGET,
      error_budget_spent_percent: Number(
        (
          (Math.max(0, 100 - httpSummary.availability_percent))
          / Math.max(0.0001, 100 - SLO_API_AVAILABILITY_TARGET)
        ).toFixed(4)
      ),
    },
    {
      key: 'api_latency_p95',
      description: 'API p95 latency under target',
      target_ms: SLO_API_P95_MS_TARGET,
      actual_ms: httpSummary.latency_ms.p95,
      met: httpSummary.latency_ms.p95 <= SLO_API_P95_MS_TARGET,
    },
    {
      key: 'ws_delivery_ratio',
      description: 'WebSocket delivered/published ratio',
      target_percent: SLO_WS_DELIVERY_TARGET,
      actual_percent: streamDelivery,
      met: streamDelivery >= SLO_WS_DELIVERY_TARGET,
    },
    {
      key: 'ws_drop_rate',
      description: 'WebSocket dropped/(delivered+dropped) ratio',
      target_max_percent: SLO_WS_DROP_RATE_TARGET,
      actual_percent: wsDropRate,
      met: wsDropRate <= SLO_WS_DROP_RATE_TARGET,
    },
  ];

  return {
    generated_at: new Date().toISOString(),
    window_ms: SLO_WINDOW_MS,
    objectives,
    status: objectives.every((objective) => objective.met) ? 'healthy' : 'at_risk',
    http: httpSummary,
    ws: {
      delivery_ratio_percent: streamDelivery,
      drop_rate_percent: wsDropRate,
      window_counters: wsWindow.counters,
      current_totals: {
        published_events: toSafeNumber(streamStatus.published_events, 0),
        delivered_messages: toSafeNumber(streamStatus.delivered_messages, 0),
        dropped_messages: toSafeNumber(streamStatus.dropped_messages, 0),
        rate_limited_messages: toSafeNumber(streamStatus.rate_limited_messages, 0),
        auth_failures: toSafeNumber(streamStatus.auth_failures, 0),
        unauthorized_subscriptions: toSafeNumber(streamStatus.unauthorized_subscriptions, 0),
        rejected_connections: toSafeNumber(streamStatus.rejected_connections, 0),
      },
    },
  };
}

function toPrometheusMetrics(streamStatus = {}) {
  const lines = [];
  lines.push('# HELP qaero_process_uptime_seconds Process uptime in seconds');
  lines.push('# TYPE qaero_process_uptime_seconds gauge');
  lines.push(`qaero_process_uptime_seconds ${Number((process.uptime() || 0).toFixed(6))}`);
  lines.push('# HELP qaero_process_resident_memory_bytes Resident memory usage in bytes');
  lines.push('# TYPE qaero_process_resident_memory_bytes gauge');
  lines.push(`qaero_process_resident_memory_bytes ${process.memoryUsage().rss}`);

  lines.push('# HELP qaero_http_requests_total Total HTTP requests by method/route/status_class');
  lines.push('# TYPE qaero_http_requests_total counter');
  getCounterSnapshot().forEach((counter) => {
    lines.push(
      `qaero_http_requests_total{method="${counter.method}",route="${counter.route}",status_class="${counter.status_class}"} ${counter.count}`
    );
  });

  const samples = getHttpSamples(ALERT_WINDOW_MS);
  const buckets = [50, 100, 250, 500, 1000, 2000, 5000];
  const bucketCounts = buckets.map((bucket) => ({
    le: bucket,
    count: samples.filter((sample) => sample.duration_ms <= bucket).length,
  }));

  lines.push('# HELP qaero_http_request_duration_ms_bucket Rolling request latency buckets');
  lines.push('# TYPE qaero_http_request_duration_ms_bucket histogram');
  bucketCounts.forEach((bucket) => {
    lines.push(`qaero_http_request_duration_ms_bucket{le="${bucket.le}"} ${bucket.count}`);
  });
  lines.push(`qaero_http_request_duration_ms_bucket{le="+Inf"} ${samples.length}`);

  const sumLatency = samples.reduce((sum, sample) => sum + sample.duration_ms, 0);
  lines.push(`# HELP qaero_http_request_duration_ms_sum Rolling request latency sum`);
  lines.push('# TYPE qaero_http_request_duration_ms_sum gauge');
  lines.push(`qaero_http_request_duration_ms_sum ${Number(sumLatency.toFixed(6))}`);
  lines.push('# HELP qaero_http_request_duration_ms_count Rolling request latency count');
  lines.push('# TYPE qaero_http_request_duration_ms_count gauge');
  lines.push(`qaero_http_request_duration_ms_count ${samples.length}`);

  lines.push('# HELP qaero_evolution_ws_connected_clients Active websocket clients');
  lines.push('# TYPE qaero_evolution_ws_connected_clients gauge');
  lines.push(`qaero_evolution_ws_connected_clients ${toSafeNumber(streamStatus.connected_clients, 0)}`);

  lines.push('# HELP qaero_evolution_ws_published_events_total Evolution websocket published events');
  lines.push('# TYPE qaero_evolution_ws_published_events_total counter');
  lines.push(`qaero_evolution_ws_published_events_total ${toSafeNumber(streamStatus.published_events, 0)}`);

  lines.push('# HELP qaero_evolution_ws_delivered_messages_total Evolution websocket delivered messages');
  lines.push('# TYPE qaero_evolution_ws_delivered_messages_total counter');
  lines.push(`qaero_evolution_ws_delivered_messages_total ${toSafeNumber(streamStatus.delivered_messages, 0)}`);

  lines.push('# HELP qaero_evolution_ws_dropped_messages_total Evolution websocket dropped messages');
  lines.push('# TYPE qaero_evolution_ws_dropped_messages_total counter');
  lines.push(`qaero_evolution_ws_dropped_messages_total ${toSafeNumber(streamStatus.dropped_messages, 0)}`);

  lines.push('# HELP qaero_evolution_ws_rate_limited_messages_total Evolution websocket rate-limited messages');
  lines.push('# TYPE qaero_evolution_ws_rate_limited_messages_total counter');
  lines.push(`qaero_evolution_ws_rate_limited_messages_total ${toSafeNumber(streamStatus.rate_limited_messages, 0)}`);

  lines.push('# HELP qaero_evolution_ws_auth_failures_total Evolution websocket auth failures');
  lines.push('# TYPE qaero_evolution_ws_auth_failures_total counter');
  lines.push(`qaero_evolution_ws_auth_failures_total ${toSafeNumber(streamStatus.auth_failures, 0)}`);

  lines.push('# HELP qaero_evolution_ws_unauthorized_subscriptions_total Evolution websocket unauthorized subscriptions');
  lines.push('# TYPE qaero_evolution_ws_unauthorized_subscriptions_total counter');
  lines.push(`qaero_evolution_ws_unauthorized_subscriptions_total ${toSafeNumber(streamStatus.unauthorized_subscriptions, 0)}`);

  const protectionMode = String(streamStatus?.protection?.mode || 'normal').toLowerCase();
  lines.push('# HELP qaero_evolution_ws_protection_mode Evolution websocket protection mode state');
  lines.push('# TYPE qaero_evolution_ws_protection_mode gauge');
  ['normal', 'elevated', 'strict'].forEach((mode) => {
    lines.push(`qaero_evolution_ws_protection_mode{mode="${mode}"} ${protectionMode === mode ? 1 : 0}`);
  });

  return `${lines.join('\n')}\n`;
}

function getObservabilitySnapshot(streamStatus = {}) {
  const wsAlertWindow = summarizeWsWindow(streamStatus, ALERT_WINDOW_MS);
  const wsSloWindow = summarizeWsWindow(streamStatus, SLO_WINDOW_MS);

  return {
    generated_at: new Date().toISOString(),
    process: {
      uptime_seconds: Number((process.uptime() || 0).toFixed(6)),
      resident_memory_bytes: process.memoryUsage().rss,
      booted_at: new Date(BOOT_TS).toISOString(),
    },
    http: {
      counters: getCounterSnapshot(),
      alert_window: summarizeHttp(ALERT_WINDOW_MS),
      slo_window: summarizeHttp(SLO_WINDOW_MS),
    },
    ws: {
      connected_clients: toSafeNumber(streamStatus.connected_clients, 0),
      current_totals: {
        published_events: toSafeNumber(streamStatus.published_events, 0),
        delivered_messages: toSafeNumber(streamStatus.delivered_messages, 0),
        dropped_messages: toSafeNumber(streamStatus.dropped_messages, 0),
        rate_limited_messages: toSafeNumber(streamStatus.rate_limited_messages, 0),
        auth_failures: toSafeNumber(streamStatus.auth_failures, 0),
        unauthorized_subscriptions: toSafeNumber(streamStatus.unauthorized_subscriptions, 0),
        rejected_connections: toSafeNumber(streamStatus.rejected_connections, 0),
      },
      alert_window: wsAlertWindow,
      slo_window: wsSloWindow,
      delivery_ratio_percent: computeStreamDeliveryRatio(streamStatus),
      drop_rate_percent: computeStreamDropRate(streamStatus),
    },
  };
}

function getObservabilityConfig() {
  return {
    generated_at: new Date().toISOString(),
    profile: OBS_PROFILE,
    windows: {
      alert_window_ms: ALERT_WINDOW_MS,
      slo_window_ms: SLO_WINDOW_MS,
      max_http_samples: MAX_HTTP_SAMPLES,
      max_ws_samples: MAX_WS_SAMPLES,
    },
    alerts: {
      http_error_rate_percent: ALERT_HTTP_ERROR_RATE_PERCENT,
      http_p95_ms: ALERT_HTTP_P95_MS,
      ws_drop_rate_percent: ALERT_WS_DROP_RATE_PERCENT,
      ws_auth_failure_count: ALERT_WS_AUTH_FAILURE_COUNT,
      ws_rate_limited_count: ALERT_WS_RATE_LIMITED_COUNT,
      ws_unauthorized_subscription_count: ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT,
      ws_rejected_connection_count: ALERT_WS_REJECTED_CONNECTION_COUNT,
    },
    slo_targets: {
      api_availability_percent: SLO_API_AVAILABILITY_TARGET,
      api_p95_ms: SLO_API_P95_MS_TARGET,
      ws_delivery_percent: SLO_WS_DELIVERY_TARGET,
      ws_drop_rate_percent: SLO_WS_DROP_RATE_TARGET,
    },
    calibration: {
      lookback_ms: CALIBRATION_LOOKBACK_MS,
      bucket_ms: CALIBRATION_BUCKET_MS,
      min_buckets: CALIBRATION_MIN_BUCKETS,
    },
    profile_defaults: {
      windows: {
        alert_window_ms: OBS_PROFILE_SETTINGS.alert_window_ms,
        slo_window_ms: OBS_PROFILE_SETTINGS.slo_window_ms,
        max_http_samples: OBS_PROFILE_SETTINGS.max_http_samples,
        max_ws_samples: OBS_PROFILE_SETTINGS.max_ws_samples,
      },
      alerts: OBS_PROFILE_SETTINGS.alerts,
      slo_targets: OBS_PROFILE_SETTINGS.slo_targets,
      calibration: OBS_PROFILE_SETTINGS.calibration,
    },
  };
}

module.exports = {
  recordHttpRequestMetric,
  evaluateAlerts,
  evaluateSlo,
  getObservabilitySnapshot,
  getObservabilityConfig,
  calibrateObservabilityThresholds,
  toPrometheusMetrics,
  __test__: {
    resetObservabilityState: () => {
      httpRequestCounters.clear();
      httpRequestSamples.splice(0, httpRequestSamples.length);
      wsCounterSamples.splice(0, wsCounterSamples.length);
    },
    summarizeHttp,
    computeStreamDeliveryRatio,
    computeStreamDropRate,
    summarizeWsWindow,
    buildHttpBucketSummaries,
    buildWsBucketSummaries,
    summarizeSeries,
    resolveObservabilityProfile,
  },
};
