# Quantum-Aero Operations Runbook

Production incident and response guide for backend auth, websocket stream reliability, and observability alerts.

## Scope

- Backend APIs (`/api/*`)
- Evolution websocket stream (`/ws/evolution`)
- Auth/session lifecycle (`/api/auth/*`)
- Observability endpoints (`/api/system/observability/*`)
- Quantum provider reliability calibration/rollout (`/api/quantum/providers/*`)

## Fast Triage

1. Check global health:
   - `GET /api/system/health`
2. Check active alerts:
   - `GET /api/system/observability/alerts`
3. Check SLO status:
   - `GET /api/system/observability/slo`
4. Check configured thresholds:
   - `GET /api/system/observability/config`
5. Check sustained-window calibration recommendations:
   - `GET /api/system/observability/calibration?lookback_minutes=60&bucket_seconds=60`
6. Check recommended mitigation plan:
   - `GET /api/system/observability/incident-plan`
7. Check security/audit stream:
   - `GET /api/system/observability/audit?since_minutes=120&limit=50`
   - `GET /api/system/observability/audit/summary?window_minutes=120`

## Incident Automation API

- Plan endpoint:
  - `GET /api/system/observability/incident-plan`
- Execute endpoint:
  - `POST /api/system/observability/incident-actions/execute`
  - body: `{ "action_id": "ws_protection_strict", "dry_run": true }`
  - optional headers:
    - `x-incident-token` (required only if `OBS_INCIDENT_AUTOMATION_TOKEN` is set)
    - `x-operator-id`
    - `x-operator-email`

Supported automation actions:

- `ws_protection_normal`
- `ws_protection_elevated`
- `ws_protection_strict`

Manual/no-op actions (runbook guidance only):

- `ops_manual_scale_out`
- `ops_manual_rollback`

Optional executable bindings for manual actions:

- `OBS_ACTION_SCALE_OUT_CMD` (JSON array preferred)
- `OBS_ACTION_ROLLBACK_CMD` (JSON array preferred)
- `OBS_ACTION_EXEC_TIMEOUT_MS`
- `OBS_ACTION_EXEC_MAX_OUTPUT_BYTES`
- `OBS_ACTION_POLICY_MODE=permissive|allowlist|locked`
- `OBS_ACTION_REQUIRE_ABSOLUTE_PATH=true|false`
- `OBS_ACTION_ALLOWED_BINARIES=[...]` (or comma-separated list)

When these command bindings are configured, `incident-actions/execute` with `dry_run=false` can execute the manual action and persist execution metadata in audit events.
In `locked`/`allowlist` modes the command is blocked unless it passes policy checks (absolute path + allowlist match).

Important env flags:

- `OBS_INCIDENT_AUTOMATION_ENABLED=true|false`
- `OBS_INCIDENT_AUTOMATION_TOKEN=<token>`
- `EVOLUTION_WS_PROTECTION_MODE=normal|elevated|strict`
- `OBS_ENV_PROFILE=dev|test|staging|prod`
- `OBS_CALIBRATION_LOOKBACK_MS`
- `OBS_CALIBRATION_BUCKET_MS`
- `OBS_CALIBRATION_MIN_BUCKETS`
- `OBS_ACTION_SCALE_OUT_CMD=[...]`
- `OBS_ACTION_ROLLBACK_CMD=[...]`

## Threshold Calibration Workflow

1. Run a sustained traffic replay (or use production window).
2. Inspect calibration payload:
   - `GET /api/system/observability/calibration?lookback_minutes=60&bucket_seconds=60`
3. Check `data.confidence.level`:
   - `high`: safe to promote recommendations after review.
   - `medium`: validate with another replay window.
   - `low`: keep current thresholds and gather more traffic.
4. Promote selected values from `data.recommendations.env_overrides` into environment config.

## Quantum Live Rollout Workflow

1. Run sustained collector in each environment (continuous or bounded window):
   - `npm --prefix services/backend run calibration:quantum:collect -- --base-url http://localhost:3001 --source provider-collector-prod --mode status+optimize`
   - when ingest token enforcement is enabled, provide `--ingest-token <token>`
   - collector posts into `POST /api/quantum/providers/reliability-samples`
2. Verify persistence/status before approval:
   - `GET /api/quantum/providers/reliability-storage-status?provider=vqe&source=provider-collector-prod`
   - `GET /api/quantum/providers/reliability-storage-status?provider=dwave&source=provider-collector-prod`
   - `GET /api/quantum/providers/reliability-source-status?source=provider-collector-prod&window_minutes=120&stale_seconds=900`
3. Generate multi-environment signoff summary:
   - `npm --prefix services/backend run calibration:quantum:signoff -- --source-by-env staging:provider-collector-staging,prod:provider-collector-prod --persist-signoff true --fail-on-blocked true`
4. Validate persisted signoff evidence in backend:
   - `GET /api/quantum/providers/reliability-rollout-signoff?environment=prod&status=approved`
   - `GET /api/quantum/providers/reliability-rollout-signoff/latest?environment=prod`
   - `GET /api/quantum/providers/reliability-rollout-signoff-storage-status?environment=prod`
5. Run strict approval automation:
   - `npm --prefix services/backend run calibration:quantum:approve-live -- --environment prod --source provider-collector-prod`
6. If strict mode blocks promotion, inspect blockers in generated report and continue data collection.
7. Promote only approved env packs through deployment workflow.

Important quantum rollout env flags:

- `QUANTUM_RELIABILITY_INGEST_MAX_BATCH`
- `QUANTUM_RELIABILITY_INGEST_REQUIRE_TOKEN`
- `QUANTUM_RELIABILITY_INGEST_TOKEN`
- `QUANTUM_RELIABILITY_INGEST_ALLOWED_SOURCES`
- `QUANTUM_RELIABILITY_LIVE_SOURCE_TAGS`
- `QUANTUM_RELIABILITY_COLLECTOR_SOURCE`
- `QUANTUM_RELIABILITY_COLLECTOR_MODE`
- `QUANTUM_RELIABILITY_COLLECTOR_INTERVAL_SECONDS`
- `QUANTUM_RELIABILITY_COLLECTOR_ALLOW_FALLBACK`
- `QUANTUM_RELIABILITY_COLLECTOR_FAIL_ON_INGEST_ERROR`
- `QUANTUM_RELIABILITY_SOURCE_STATUS_STALE_MS`
- `QUANTUM_ROLLOUT_REQUIRE_PERSISTED_STORE`
- `QUANTUM_ROLLOUT_REQUIRE_LIVE_SOURCE`
- `QUANTUM_ROLLOUT_MIN_LIVE_SIGNAL_BUCKETS`
- `QUANTUM_ROLLOUT_REQUIRE_RECENT_SAMPLES`
- `QUANTUM_ROLLOUT_MAX_SAMPLE_AGE_MS`
- `QUANTUM_ROLLOUT_MAX_FALLBACK_RATIO_PERCENT`
- `QUANTUM_ROLLOUT_MIN_SIGNAL_BUCKETS`
- `QUANTUM_ROLLOUT_MIN_CONFIDENCE`
- `QUANTUM_ROLLOUT_SIGNOFF_ENVIRONMENTS`
- `QUANTUM_ROLLOUT_SIGNOFF_INCLUDE_CALIBRATION`
- `QUANTUM_ROLLOUT_SIGNOFF_PERSIST_RESULTS`
- `QUANTUM_ROLLOUT_SIGNOFF_FAIL_ON_BLOCKED`
- `QUANTUM_ROLLOUT_SIGNOFF_RETENTION_MS`
- `QUANTUM_ROLLOUT_SIGNOFF_MEMORY_MAX_RECORDS`

## Alert-to-Action Mapping

### `api_error_rate_high`

- Meaning: 5xx rate exceeded `ALERT_HTTP_ERROR_RATE_PERCENT`.
- Immediate checks:
  - API logs for route-level failures.
  - Upstream service reachability (`physics`, `ml`, `quantum`).
- Mitigation:
  - Shift traffic to fallback-contract routes when upstream instability is detected.
  - Temporarily reduce load from non-critical simulation batch jobs.

### `api_latency_p95_high`

- Meaning: p95 exceeded `ALERT_HTTP_P95_MS`.
- Immediate checks:
  - high-concurrency endpoints (`/api/simulation/*`, `/api/evolution/*`)
  - resource pressure (RSS, heap, CPU load)
- Mitigation:
  - Reduce batch sizes and polling frequency.
  - Scale backend replicas and investigate slow dependencies.

### `ws_drop_rate_high`

- Meaning: websocket drop ratio exceeded `ALERT_WS_DROP_RATE_PERCENT`.
- Immediate checks:
  - stream backpressure counters in `alerts.ws.window_counters`.
  - client reconnect patterns.
- Mitigation:
  - Increase `EVOLUTION_WS_MAX_BUFFERED_BYTES` and/or reduce publish frequency.
  - throttle noisy channels until drop rate normalizes.

### `ws_auth_failures_high`

- Meaning: auth failures in current window exceeded `ALERT_WS_AUTH_FAILURE_COUNT`.
- Immediate checks:
  - invalid/missing token patterns in audit events (`evolution.ws.connection_denied`).
  - token refresh/revocation events around spike window.
- Mitigation:
  - verify JWT/refresh configuration consistency across environments.
  - enforce client-side refresh before ws reconnect attempts.

### `ws_rate_limited_high`

- Meaning: message rate-limit denials exceeded `ALERT_WS_RATE_LIMITED_COUNT`.
- Immediate checks:
  - client command burst behavior (subscribe/ping loops).
  - abusive or misconfigured consumers.
- Mitigation:
  - lower reconnect churn and subscribe loops in client.
  - adjust `EVOLUTION_WS_MAX_MESSAGES_PER_WINDOW` only after abuse analysis.

### `ws_unauthorized_subscriptions_high`

- Meaning: denied subscribe attempts exceeded `ALERT_WS_UNAUTHORIZED_SUBSCRIPTION_COUNT`.
- Immediate checks:
  - per-car ACL policy changes and affected users.
  - audit actions `evolution.ws.acl_denied`.
- Mitigation:
  - verify `allowed_car_ids` policy propagation.
  - reissue sessions for recently updated users if needed.

### `ws_rejected_connections_high`

- Meaning: denied websocket handshakes exceeded `ALERT_WS_REJECTED_CONNECTION_COUNT`.
- Immediate checks:
  - network/service churn and session revocation spikes.
  - distribution of denial reasons (`missing_token`, `invalid_token`, `session_revoked`).
- Mitigation:
  - temporarily slow reconnect backoff on clients.
  - inspect auth provider health and clock skew.

## Auth/Session Incident Procedure

1. Confirm revocation behavior:
   - `/api/auth/logout`, `/api/auth/logout-all`, `/api/auth/refresh`
2. Verify persisted policy and token version:
   - admin policy update flow (`/api/auth/admin/users/:userId/policy`)
3. Validate websocket re-auth:
   - connect with new access token and confirm `connected` payload session id.

## WS Reliability Procedure

1. Confirm stream status:
   - `GET /api/system/observability/metrics`
2. Check `alerts.ws.window_counters` and `slo.ws.window_counters`.
3. Inspect websocket protection mode:
   - `GET /api/system/observability/incident-plan`
4. Dry-run mitigation before applying:
   - `POST /api/system/observability/incident-actions/execute` with `dry_run=true`
5. Apply mitigation if needed:
   - `POST /api/system/observability/incident-actions/execute` with `dry_run=false`
   - use `ws_protection_elevated` or `ws_protection_strict`
6. Verify contract/e2e checks before deploy:
   - `npm --prefix services/backend run test:production`

## Deploy and Rollback Guardrails

Before deploy:

1. `npm --prefix services/backend run test:production`
2. `npm --prefix frontend run lint -- --max-warnings=0`
3. `npm --prefix frontend run build`
4. `./scripts/validate_production_compose.sh`

Rollback triggers:

- persistent `ws_drop_rate_high` after mitigations
- repeated `api_error_rate_high` beyond one alert window
- auth/session regressions in refresh/revocation flow

## Post-Incident Checklist

1. Document root cause and exact alert keys fired.
2. Capture threshold values from `/api/system/observability/config`.
3. Add/adjust test coverage for the incident pattern.
4. Revalidate with:
   - backend contracts + ws e2e
   - frontend lint/build
