function restoreEnv(snapshot) {
  Object.keys(process.env).forEach((key) => {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  });
  Object.entries(snapshot).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

function loadObservabilityWithEnv(snapshot, overrides = {}) {
  restoreEnv(snapshot);
  Object.entries(overrides).forEach(([key, value]) => {
    process.env[key] = String(value);
  });
  jest.resetModules();
  return require('../../services/observability');
}

describe('Observability websocket windowing', () => {
  let envSnapshot;

  beforeEach(() => {
    envSnapshot = { ...process.env };
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  test('alerts on websocket window deltas instead of absolute totals', () => {
    const observability = loadObservabilityWithEnv(envSnapshot, {
      OBS_ALERT_WINDOW_MS: 60000,
      ALERT_WS_AUTH_FAILURE_COUNT: 2,
      ALERT_WS_RATE_LIMITED_COUNT: 1,
      ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT: 1,
      ALERT_WS_REJECTED_CONNECTION_COUNT: 1,
    });
    observability.__test__.resetObservabilityState();

    const baseline = {
      published_events: 100,
      delivered_messages: 100,
      dropped_messages: 0,
      rate_limited_messages: 0,
      auth_failures: 10,
      unauthorized_subscriptions: 5,
      rejected_connections: 2,
    };

    const first = observability.evaluateAlerts(baseline);
    expect(first.ws.window_counters).toEqual(expect.objectContaining({
      auth_failures: 0,
      rate_limited_messages: 0,
      unauthorized_subscriptions: 0,
      rejected_connections: 0,
    }));
    expect(first.active_alerts.find((alert) => alert.key === 'ws_auth_failures_high')).toBeUndefined();

    const second = observability.evaluateAlerts({
      ...baseline,
      auth_failures: 14,
      rate_limited_messages: 3,
      unauthorized_subscriptions: 8,
      rejected_connections: 5,
    });
    expect(second.ws.window_counters).toEqual(expect.objectContaining({
      auth_failures: 4,
      rate_limited_messages: 3,
      unauthorized_subscriptions: 3,
      rejected_connections: 3,
    }));

    const alertKeys = second.active_alerts.map((alert) => alert.key);
    expect(alertKeys).toEqual(expect.arrayContaining([
      'ws_auth_failures_high',
      'ws_rate_limited_high',
      'ws_unauthorized_subscriptions_high',
      'ws_rejected_connections_high',
    ]));
  });

  test('slo uses websocket window counters and exposes threshold config', () => {
    const observability = loadObservabilityWithEnv(envSnapshot, {
      OBS_SLO_WINDOW_MS: 60000,
      SLO_WS_DELIVERY_TARGET: 90,
      SLO_WS_DROP_RATE_TARGET: 10,
    });
    observability.__test__.resetObservabilityState();

    const baseline = {
      published_events: 100,
      delivered_messages: 100,
      dropped_messages: 0,
      rate_limited_messages: 0,
      auth_failures: 0,
      unauthorized_subscriptions: 0,
      rejected_connections: 0,
    };
    observability.evaluateSlo(baseline);

    const degraded = observability.evaluateSlo({
      ...baseline,
      published_events: 220,
      delivered_messages: 160,
      dropped_messages: 60,
    });

    const deliveryObjective = degraded.objectives.find((objective) => objective.key === 'ws_delivery_ratio');
    const dropObjective = degraded.objectives.find((objective) => objective.key === 'ws_drop_rate');
    expect(deliveryObjective).toEqual(expect.objectContaining({ met: false }));
    expect(dropObjective).toEqual(expect.objectContaining({ met: false }));
    expect(degraded.ws.window_counters).toEqual(expect.objectContaining({
      published_events: 120,
      delivered_messages: 60,
      dropped_messages: 60,
    }));

    const config = observability.getObservabilityConfig();
    expect(config).toEqual(expect.objectContaining({
      profile: expect.any(String),
      windows: expect.objectContaining({
        alert_window_ms: expect.any(Number),
        slo_window_ms: 60000,
      }),
      alerts: expect.objectContaining({
        ws_drop_rate_percent: expect.any(Number),
        ws_rate_limited_count: expect.any(Number),
      }),
      slo_targets: expect.objectContaining({
        ws_delivery_percent: 90,
        ws_drop_rate_percent: 10,
      }),
    }));
  });

  test('calibrates alert and SLO recommendations from sustained traffic buckets', () => {
    const observability = loadObservabilityWithEnv(envSnapshot, {
      OBS_ENV_PROFILE: 'prod',
      OBS_CALIBRATION_LOOKBACK_MS: 30 * 60 * 1000,
      OBS_CALIBRATION_BUCKET_MS: 60 * 1000,
      OBS_CALIBRATION_MIN_BUCKETS: 6,
    });
    observability.__test__.resetObservabilityState();

    const dateNowSpy = jest.spyOn(Date, 'now');
    const startTs = 1_700_000_000_000;
    let simulatedTs = startTs;
    dateNowSpy.mockImplementation(() => simulatedTs);

    let wsTotals = {
      published_events: 100,
      delivered_messages: 98,
      dropped_messages: 2,
      rate_limited_messages: 0,
      auth_failures: 0,
      unauthorized_subscriptions: 0,
      rejected_connections: 0,
    };

    let calibration;
    try {
      for (let minute = 0; minute < 12; minute += 1) {
        const statusCode = minute % 7 === 0 ? 500 : 200;
        observability.recordHttpRequestMetric({
          method: 'GET',
          route: '/api/system/health',
          statusCode,
          durationMs: 180 + (minute * 8),
        });
        observability.recordHttpRequestMetric({
          method: 'GET',
          route: '/api/evolution/telemetry',
          statusCode: 200,
          durationMs: 260 + (minute * 5),
        });

        wsTotals = {
          ...wsTotals,
          published_events: wsTotals.published_events + 12,
          delivered_messages: wsTotals.delivered_messages + 11,
          dropped_messages: wsTotals.dropped_messages + 1,
          rate_limited_messages: wsTotals.rate_limited_messages + (minute % 3 === 0 ? 1 : 0),
          auth_failures: wsTotals.auth_failures + (minute % 4 === 0 ? 1 : 0),
          unauthorized_subscriptions: wsTotals.unauthorized_subscriptions + (minute % 5 === 0 ? 1 : 0),
          rejected_connections: wsTotals.rejected_connections + (minute % 6 === 0 ? 1 : 0),
        };
        observability.evaluateAlerts(wsTotals);
        simulatedTs += 60_000;
      }

      calibration = observability.calibrateObservabilityThresholds(wsTotals, {
        lookback_minutes: 20,
        bucket_seconds: 60,
        min_buckets: 6,
      });
    } finally {
      dateNowSpy.mockRestore();
    }

    expect(calibration).toEqual(expect.objectContaining({
      profile: 'prod',
      confidence: expect.objectContaining({
        level: expect.stringMatching(/high|medium|low/),
      }),
      recommendations: expect.objectContaining({
        source: expect.stringMatching(/traffic_window_calibration|current_threshold_fallback/),
        env_overrides: expect.objectContaining({
          ALERT_HTTP_ERROR_RATE_PERCENT: expect.any(Number),
          SLO_WS_DELIVERY_TARGET: expect.any(Number),
        }),
      }),
      sample_counts: expect.objectContaining({
        http_buckets: expect.any(Number),
        ws_buckets: expect.any(Number),
      }),
    }));

    expect(calibration.sample_counts.http_buckets).toBeGreaterThanOrEqual(6);
    expect(calibration.sample_counts.ws_buckets).toBeGreaterThanOrEqual(6);
  });
});
