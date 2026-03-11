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

function loadExecutorWithEnv(snapshot, overrides = {}) {
  restoreEnv(snapshot);
  Object.entries(overrides).forEach(([key, value]) => {
    process.env[key] = String(value);
  });
  jest.resetModules();
  return require('../../services/incidentActionExecutor');
}

describe('incidentActionExecutor policy lock behavior', () => {
  let envSnapshot;

  beforeEach(() => {
    envSnapshot = { ...process.env };
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  test('blocks configured manual action when absolute path is required', async () => {
    const executor = loadExecutorWithEnv(envSnapshot, {
      OBS_ENV_PROFILE: 'prod',
      OBS_ACTION_POLICY_MODE: 'locked',
      OBS_ACTION_REQUIRE_ABSOLUTE_PATH: 'true',
      OBS_ACTION_ALLOWED_BINARIES: '["/usr/bin/echo"]',
      OBS_ACTION_SCALE_OUT_CMD: '["echo","scale"]',
    });

    const result = await executor.executeManualIncidentAction('ops_manual_scale_out', {
      dryRun: true,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: 'action_policy_blocked',
      action_id: 'ops_manual_scale_out',
      policy: expect.objectContaining({
        allowed: false,
        reason: 'absolute_path_required',
      }),
    }));
  });

  test('blocks configured manual action when allowlist is empty in locked mode', async () => {
    const executor = loadExecutorWithEnv(envSnapshot, {
      OBS_ENV_PROFILE: 'prod',
      OBS_ACTION_POLICY_MODE: 'locked',
      OBS_ACTION_REQUIRE_ABSOLUTE_PATH: 'true',
      OBS_ACTION_ALLOWED_BINARIES: '',
      OBS_ACTION_SCALE_OUT_CMD: '["/usr/bin/echo","scale"]',
    });

    const result = await executor.executeManualIncidentAction('ops_manual_scale_out', {
      dryRun: true,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: 'action_policy_blocked',
      policy: expect.objectContaining({
        allowed: false,
        reason: 'allowlist_required',
      }),
    }));
  });

  test('allows dry-run manual action when command is allowlisted', async () => {
    const executor = loadExecutorWithEnv(envSnapshot, {
      OBS_ENV_PROFILE: 'prod',
      OBS_ACTION_POLICY_MODE: 'locked',
      OBS_ACTION_REQUIRE_ABSOLUTE_PATH: 'true',
      OBS_ACTION_ALLOWED_BINARIES: '["/usr/bin/echo"]',
      OBS_ACTION_SCALE_OUT_CMD: '["/usr/bin/echo","scale"]',
    });

    const result = await executor.executeManualIncidentAction('ops_manual_scale_out', {
      dryRun: true,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      dry_run: true,
      applied: false,
      message: 'executor_dry_run',
    }));

    const config = executor.getIncidentActionExecutorConfig();
    expect(config).toEqual(expect.objectContaining({
      profile: 'prod',
      policy: expect.objectContaining({
        mode: 'locked',
      }),
      actions: expect.objectContaining({
        ops_manual_scale_out: expect.objectContaining({
          configured: true,
          policy: expect.objectContaining({
            allowed: true,
            reason: 'allowlisted',
          }),
        }),
      }),
    }));
  });

  test('permits non-absolute command in permissive mode', async () => {
    const executor = loadExecutorWithEnv(envSnapshot, {
      OBS_ENV_PROFILE: 'dev',
      OBS_ACTION_POLICY_MODE: 'permissive',
      OBS_ACTION_REQUIRE_ABSOLUTE_PATH: 'false',
      OBS_ACTION_ALLOWED_BINARIES: '',
      OBS_ACTION_SCALE_OUT_CMD: 'echo scale',
    });

    const result = await executor.executeManualIncidentAction('ops_manual_scale_out', {
      dryRun: true,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      dry_run: true,
      message: 'executor_dry_run',
    }));
  });
});
