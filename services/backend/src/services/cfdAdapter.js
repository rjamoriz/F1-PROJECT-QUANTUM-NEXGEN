/**
 * CFD Adapter Service
 * Provides an extensible plugin boundary for CFD execution backends.
 */

const axios = require('axios');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFixedNumber(value, decimals = 6) {
  return Number(Number(value).toFixed(decimals));
}

function hashToUnitInterval(value) {
  const text = String(value || 'seed');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }

  return (Math.abs(hash) % 10000) / 10000;
}

class BaseCFDEngine {
  constructor(engineName) {
    this.engineName = engineName;
  }

  async submitCase() {
    throw new Error('submitCase() not implemented');
  }

  async getJobStatus() {
    throw new Error('getJobStatus() not implemented');
  }

  async waitForCompletion(jobId, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
    const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? options.pollIntervalMs : 300;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const status = await this.getJobStatus(jobId);

      if (!status) {
        throw new Error(`Unknown CFD job id: ${jobId}`);
      }

      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(`CFD job timeout: ${jobId}`);
  }
}

class MockCFDEngine extends BaseCFDEngine {
  constructor() {
    super('mock-cfd');
    this.jobs = new Map();
    this.defaultDelayMs = clamp(parseInt(process.env.CFD_MOCK_DELAY_MS, 10) || 120, 10, 2000);
  }

  _computeMetrics(payload, seed) {
    const conditions = payload.conditions || {};
    const target = payload.target_metrics || {};

    const baseCl = Number.isFinite(target.cl) ? target.cl : 2.2;
    const baseCd = Number.isFinite(target.cd) ? target.cd : 0.45;
    const baseCm = Number.isFinite(target.cm) ? target.cm : -0.08;

    const alpha = Number.isFinite(conditions.alpha) ? conditions.alpha : 4.5;
    const yaw = Math.abs(Number.isFinite(conditions.yaw) ? conditions.yaw : 0);
    const selectedRatio = Number.isFinite(payload.selected_ratio) ? payload.selected_ratio : 0;

    const turbulenceFactor = 1 + 0.004 * yaw + 0.0015 * Math.max(alpha - 4, 0);
    const liftCorrection = 0.992 - 0.001 * yaw + 0.015 * selectedRatio;
    const dragCorrection = turbulenceFactor * (1 - 0.01 * selectedRatio);

    const noise = (seed - 0.5) * 0.006;

    const cl = toFixedNumber(baseCl * liftCorrection + noise);
    const cd = toFixedNumber(Math.max(baseCd * dragCorrection + 0.25 * noise, 1e-6));
    const cm = toFixedNumber(baseCm * (1 - 0.02 * selectedRatio) + 0.1 * noise);

    return {
      cl,
      cd,
      cm,
      l_over_d: toFixedNumber(cl / Math.max(cd, 1e-6)),
      residual_l2: toFixedNumber(1e-3 + 2e-4 * yaw + 1e-4 * (1 - selectedRatio), 8),
      converged: true,
      iterations: clamp(Math.round(350 + 80 * seed), 100, 900),
      solver: 'mock-steady-rans',
      source: 'cfd_adapter_mock',
    };
  }

  async submitCase(payload = {}) {
    const jobId = payload.job_id || `cfd_${randomUUID()}`;
    const createdAt = Date.now();
    const seed = hashToUnitInterval(jobId + JSON.stringify(payload.target_metrics || {}));
    const delayMs = this.defaultDelayMs + Math.round(seed * 120);
    const readyAt = createdAt + delayMs;

    const result = {
      metrics: this._computeMetrics(payload, seed),
      metadata: {
        engine: this.engineName,
        stage: payload.stage || 'unknown',
        simulation_id: payload.simulation_id || null,
      },
    };

    this.jobs.set(jobId, {
      job_id: jobId,
      status: 'queued',
      created_at: new Date(createdAt).toISOString(),
      ready_at: new Date(readyAt).toISOString(),
      result,
      error: null,
    });

    return {
      job_id: jobId,
      status: 'queued',
      engine: this.engineName,
      eta_ms: delayMs,
    };
  }

  async getJobStatus(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    const now = Date.now();
    const readyAt = new Date(job.ready_at).getTime();

    let status = 'running';
    if (now < readyAt - 20) {
      status = 'running';
    } else if (now >= readyAt) {
      status = 'completed';
    }

    job.status = status;

    return {
      job_id: job.job_id,
      status,
      engine: this.engineName,
      created_at: job.created_at,
      completed_at: status === 'completed' ? new Date(readyAt).toISOString() : null,
      result: status === 'completed' ? job.result : null,
      error: job.error,
    };
  }
}

class HttpCFDEngine extends BaseCFDEngine {
  constructor(baseUrl, timeoutMs = 45000) {
    super('http-cfd');
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async submitCase(payload = {}) {
    const response = await this.client.post('/jobs', payload);
    return {
      job_id: response.data.job_id,
      status: response.data.status || 'queued',
      engine: this.engineName,
      eta_ms: response.data.eta_ms,
    };
  }

  async getJobStatus(jobId) {
    const response = await this.client.get(`/jobs/${jobId}`);
    return {
      job_id: response.data.job_id || jobId,
      status: response.data.status,
      engine: this.engineName,
      created_at: response.data.created_at,
      completed_at: response.data.completed_at || null,
      result: response.data.result || null,
      error: response.data.error || null,
    };
  }
}

function createCFDAdapter(options = {}) {
  const engineType = (options.engineType || process.env.CFD_ENGINE || 'mock').toLowerCase();
  const serviceUrl = options.baseUrl || process.env.CFD_SERVICE_URL;

  let engine;
  if (engineType === 'http' && serviceUrl) {
    engine = new HttpCFDEngine(serviceUrl);
    logger.info(`CFD adapter initialized with HTTP engine (${serviceUrl})`);
  } else {
    if (engineType === 'http' && !serviceUrl) {
      logger.warn('CFD_ENGINE=http configured without CFD_SERVICE_URL, falling back to mock engine');
    }
    engine = new MockCFDEngine();
    logger.info('CFD adapter initialized with mock engine');
  }

  return {
    engineName: engine.engineName,

    async submitCase(payload = {}) {
      return engine.submitCase(payload);
    },

    async getJobStatus(jobId) {
      return engine.getJobStatus(jobId);
    },

    async evaluateCase(payload = {}, executionOptions = {}) {
      const submission = await engine.submitCase(payload);
      const completed = await engine.waitForCompletion(
        submission.job_id,
        {
          timeoutMs: executionOptions.timeoutMs,
          pollIntervalMs: executionOptions.pollIntervalMs,
        }
      );

      return {
        submission,
        completed,
      };
    },
  };
}

module.exports = {
  createCFDAdapter,
};
