const { spawn } = require('child_process');
const path = require('path');

const DEFAULT_TIMEOUT_MS = Number.isFinite(Number(process.env.OBS_ACTION_EXEC_TIMEOUT_MS))
  ? Math.min(Math.max(Number(process.env.OBS_ACTION_EXEC_TIMEOUT_MS), 1_000), 120_000)
  : 15_000;
const MAX_OUTPUT_BYTES = Number.isFinite(Number(process.env.OBS_ACTION_EXEC_MAX_OUTPUT_BYTES))
  ? Math.min(Math.max(Number(process.env.OBS_ACTION_EXEC_MAX_OUTPUT_BYTES), 512), 65_536)
  : 8_192;

const ACTION_ENV_MAP = {
  ops_manual_scale_out: 'OBS_ACTION_SCALE_OUT_CMD',
  ops_manual_rollback: 'OBS_ACTION_ROLLBACK_CMD',
};

function resolveRuntimeProfile(raw = process.env.OBS_ENV_PROFILE || process.env.NODE_ENV || 'dev') {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'production' || normalized === 'prod') return 'prod';
  if (normalized === 'staging' || normalized === 'stage' || normalized === 'preprod') return 'staging';
  if (normalized === 'test') return 'test';
  return 'dev';
}

function parseBooleanValue(rawValue, fallback = false) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePolicyAllowlist(rawValue = '') {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return [];
  }
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => String(entry || '').trim())
          .filter(Boolean);
      }
      return [];
    } catch (_error) {
      return [];
    }
  }
  return raw
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

const RUNTIME_PROFILE = resolveRuntimeProfile();
const DEFAULT_POLICY_MODE = ['prod', 'staging'].includes(RUNTIME_PROFILE) ? 'locked' : 'permissive';
const POLICY_MODE = (() => {
  const normalized = String(process.env.OBS_ACTION_POLICY_MODE || DEFAULT_POLICY_MODE).trim().toLowerCase();
  if (['permissive', 'allowlist', 'locked'].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_POLICY_MODE;
})();
const POLICY_REQUIRE_ABSOLUTE_PATH = parseBooleanValue(
  process.env.OBS_ACTION_REQUIRE_ABSOLUTE_PATH,
  POLICY_MODE !== 'permissive'
);
const POLICY_ALLOWED_BINARIES = parsePolicyAllowlist(process.env.OBS_ACTION_ALLOWED_BINARIES || '');

function normalizeActionId(actionId = '') {
  return String(actionId || '').trim().toLowerCase();
}

function isSupportedAction(actionId = '') {
  return Object.prototype.hasOwnProperty.call(ACTION_ENV_MAP, normalizeActionId(actionId));
}

function parseCommandSpec(rawValue = '') {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      return null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    const command = String(parsed[0] || '').trim();
    const args = parsed.slice(1).map((value) => String(value || '').trim());
    if (!command) {
      return null;
    }
    return {
      command,
      args,
      mode: 'json_array',
    };
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  return {
    command: tokens[0],
    args: tokens.slice(1),
    mode: 'tokenized',
  };
}

function isAbsolutePath(command = '') {
  return command.startsWith('/');
}

function matchesAllowedBinary(command = '', allowedEntry = '') {
  const normalizedCommand = String(command || '').trim();
  const normalizedAllowed = String(allowedEntry || '').trim();
  if (!normalizedCommand || !normalizedAllowed) return false;
  if (normalizedCommand === normalizedAllowed) return true;
  return path.basename(normalizedCommand) === path.basename(normalizedAllowed);
}

function resolvePolicyDecision(commandSpec = null) {
  if (!commandSpec || !commandSpec.command) {
    return {
      allowed: false,
      reason: 'command_not_configured',
      mode: POLICY_MODE,
      require_absolute_path: POLICY_REQUIRE_ABSOLUTE_PATH,
      allowlisted_binaries_count: POLICY_ALLOWED_BINARIES.length,
    };
  }

  if (POLICY_MODE === 'permissive') {
    return {
      allowed: true,
      reason: 'permissive_mode',
      mode: POLICY_MODE,
      require_absolute_path: POLICY_REQUIRE_ABSOLUTE_PATH,
      allowlisted_binaries_count: POLICY_ALLOWED_BINARIES.length,
    };
  }

  if (POLICY_REQUIRE_ABSOLUTE_PATH && !isAbsolutePath(commandSpec.command)) {
    return {
      allowed: false,
      reason: 'absolute_path_required',
      mode: POLICY_MODE,
      require_absolute_path: true,
      allowlisted_binaries_count: POLICY_ALLOWED_BINARIES.length,
    };
  }

  if (POLICY_ALLOWED_BINARIES.length === 0) {
    return {
      allowed: false,
      reason: 'allowlist_required',
      mode: POLICY_MODE,
      require_absolute_path: POLICY_REQUIRE_ABSOLUTE_PATH,
      allowlisted_binaries_count: 0,
    };
  }

  const allowlisted = POLICY_ALLOWED_BINARIES.some((entry) => matchesAllowedBinary(commandSpec.command, entry));
  if (!allowlisted) {
    return {
      allowed: false,
      reason: 'binary_not_allowlisted',
      mode: POLICY_MODE,
      require_absolute_path: POLICY_REQUIRE_ABSOLUTE_PATH,
      allowlisted_binaries_count: POLICY_ALLOWED_BINARIES.length,
    };
  }

  return {
    allowed: true,
    reason: 'allowlisted',
    mode: POLICY_MODE,
    require_absolute_path: POLICY_REQUIRE_ABSOLUTE_PATH,
    allowlisted_binaries_count: POLICY_ALLOWED_BINARIES.length,
  };
}

function truncateOutput(value = '', maxBytes = MAX_OUTPUT_BYTES) {
  const text = String(value || '');
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength <= maxBytes) {
    return text;
  }
  const truncated = Buffer.from(text, 'utf8').slice(0, maxBytes).toString('utf8');
  return `${truncated}\n...[truncated]`;
}

function resolveActionCommand(actionId) {
  const normalized = normalizeActionId(actionId);
  const envKey = ACTION_ENV_MAP[normalized];
  if (!envKey) {
    return {
      configured: false,
      env_key: null,
      command: null,
    };
  }

  const parsed = parseCommandSpec(process.env[envKey] || '');
  if (!parsed) {
    return {
      configured: false,
      env_key: envKey,
      command: null,
      policy: resolvePolicyDecision(null),
    };
  }

  const policy = resolvePolicyDecision(parsed);

  return {
    configured: true,
    env_key: envKey,
    command: parsed,
    policy,
  };
}

function runCommand(command, args = [], {
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeoutHandle = null;
    let killTimeoutHandle = null;

    const complete = (payload) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killTimeoutHandle) clearTimeout(killTimeoutHandle);
      resolve({
        ...payload,
        duration_ms: Date.now() - startedAt,
        timed_out: timedOut,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
      });
    };

    let child;
    try {
      child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (error) {
      complete({
        ok: false,
        exit_code: null,
        signal: null,
        error: error.message,
      });
      return;
    }

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
      if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES * 2) {
        stdout = truncateOutput(stdout, MAX_OUTPUT_BYTES * 2);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (Buffer.byteLength(stderr, 'utf8') > MAX_OUTPUT_BYTES * 2) {
        stderr = truncateOutput(stderr, MAX_OUTPUT_BYTES * 2);
      }
    });

    child.on('error', (error) => {
      complete({
        ok: false,
        exit_code: null,
        signal: null,
        error: error.message,
      });
    });

    child.on('close', (code, signal) => {
      complete({
        ok: Number(code) === 0,
        exit_code: Number.isFinite(Number(code)) ? Number(code) : null,
        signal: signal || null,
        error: null,
      });
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch (_error) {
        // no-op
      }
      killTimeoutHandle = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_error) {
          // no-op
        }
      }, 2_000);
    }, timeoutMs);
  });
}

function getIncidentActionExecutorConfig() {
  const actions = {};
  Object.keys(ACTION_ENV_MAP).forEach((actionId) => {
    const resolved = resolveActionCommand(actionId);
    actions[actionId] = {
      configured: resolved.configured,
      env_key: resolved.env_key,
      command_preview: resolved.configured
        ? [resolved.command.command, ...resolved.command.args].join(' ')
        : null,
      parse_mode: resolved.configured ? resolved.command.mode : null,
      policy: {
        allowed: Boolean(resolved.policy?.allowed),
        reason: resolved.policy?.reason || null,
        mode: resolved.policy?.mode || POLICY_MODE,
        require_absolute_path: Boolean(resolved.policy?.require_absolute_path),
      },
    };
  });

  return {
    profile: RUNTIME_PROFILE,
    timeout_ms: DEFAULT_TIMEOUT_MS,
    max_output_bytes: MAX_OUTPUT_BYTES,
    policy: {
      mode: POLICY_MODE,
      require_absolute_path: POLICY_REQUIRE_ABSOLUTE_PATH,
      allowlisted_binaries_count: POLICY_ALLOWED_BINARIES.length,
      allowlisted_binaries: POLICY_ALLOWED_BINARIES.map((binary) => path.basename(binary)),
    },
    actions,
  };
}

async function executeManualIncidentAction(actionId, {
  dryRun = true,
} = {}) {
  const normalized = normalizeActionId(actionId);
  if (!isSupportedAction(normalized)) {
    return {
      ok: false,
      code: 'unsupported_manual_action',
      message: `Unsupported manual action: ${normalized}`,
    };
  }

  const resolved = resolveActionCommand(normalized);
  if (!resolved.configured) {
    return {
      ok: true,
      action_id: normalized,
      dry_run: true,
      applied: false,
      changed: false,
      message: 'manual_action_required',
      execution: null,
    };
  }

  if (!resolved.policy?.allowed) {
    return {
      ok: false,
      code: 'action_policy_blocked',
      message: 'Manual incident action is blocked by executor policy.',
      action_id: normalized,
      dry_run: Boolean(dryRun),
      policy: resolved.policy || null,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      action_id: normalized,
      dry_run: true,
      applied: false,
      changed: false,
      message: 'executor_dry_run',
      execution: {
        command_preview: [resolved.command.command, ...resolved.command.args].join(' '),
        timeout_ms: DEFAULT_TIMEOUT_MS,
      },
    };
  }

  const runResult = await runCommand(
    resolved.command.command,
    resolved.command.args,
    { timeoutMs: DEFAULT_TIMEOUT_MS }
  );

  if (!runResult.ok) {
    return {
      ok: false,
      code: runResult.timed_out ? 'executor_timeout' : 'executor_failed',
      message: runResult.timed_out ? 'Incident action execution timed out.' : 'Incident action execution failed.',
      execution: runResult,
    };
  }

  return {
    ok: true,
    action_id: normalized,
    dry_run: false,
    applied: true,
    changed: false,
    message: 'executor_applied',
    execution: runResult,
  };
}

module.exports = {
  executeManualIncidentAction,
  getIncidentActionExecutorConfig,
  __test__: {
    parseCommandSpec,
    resolveActionCommand,
    resolvePolicyDecision,
    parsePolicyAllowlist,
    resolveRuntimeProfile,
    runCommand,
    normalizeActionId,
  },
};
