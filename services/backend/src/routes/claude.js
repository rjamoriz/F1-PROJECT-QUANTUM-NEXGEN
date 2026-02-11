/**
 * Claude GenAI Routes
 * Local orchestration routes compatible with chat/message/stream contracts.
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { createServiceClient } = require('../utils/serviceClient');
const { ml: mlConfig, physics: physicsConfig, quantum: quantumConfig } = require('../config/services');

const QUICK_TIMEOUT_MS = 3500;

const mlClient = createServiceClient('ML Surrogate', mlConfig.baseUrl, Math.min(mlConfig.timeout, QUICK_TIMEOUT_MS));
const physicsClient = createServiceClient('Physics Engine', physicsConfig.baseUrl, Math.min(physicsConfig.timeout, QUICK_TIMEOUT_MS));
const quantumClient = createServiceClient('Quantum Optimizer', quantumConfig.baseUrl, Math.min(quantumConfig.timeout, QUICK_TIMEOUT_MS));

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFixedNumber(value, decimals = 4) {
  return Number(Number(value).toFixed(decimals));
}

function getLastUserMessage(messages = []) {
  if (!Array.isArray(messages)) {
    return '';
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const current = messages[i];
    if (current && current.role === 'user' && typeof current.content === 'string' && current.content.trim()) {
      return current.content.trim();
    }
  }

  return '';
}

function normalizeMessage(rawValue) {
  if (typeof rawValue !== 'string') {
    return '';
  }

  const normalized = rawValue.trim();
  return normalized.slice(0, 4000);
}

function normalizeContext(rawContext = {}) {
  const parameters = rawContext.parameters || rawContext.conditions || {};
  const geometry = rawContext.geometry || {};

  return {
    mesh_id: typeof rawContext.mesh_id === 'string' ? rawContext.mesh_id : 'mesh_chat_proxy',
    parameters: {
      velocity: Number.isFinite(parameters.velocity) ? parameters.velocity : 72.0,
      alpha: Number.isFinite(parameters.alpha) ? parameters.alpha : 4.5,
      yaw: Number.isFinite(parameters.yaw) ? parameters.yaw : 0.5,
      rho: Number.isFinite(parameters.rho) ? parameters.rho : 1.225,
    },
    geometry: {
      span: Number.isFinite(geometry.span) ? geometry.span : 1.2,
      chord: Number.isFinite(geometry.chord) ? geometry.chord : 0.28,
      twist: Number.isFinite(geometry.twist) ? geometry.twist : -1.0,
      dihedral: Number.isFinite(geometry.dihedral) ? geometry.dihedral : 0.0,
      sweep: Number.isFinite(geometry.sweep) ? geometry.sweep : 6.0,
      taper_ratio: Number.isFinite(geometry.taper_ratio) ? geometry.taper_ratio : 0.75,
    },
    n_panels_x: Number.isFinite(parameters.n_panels_x) ? clamp(Math.round(parameters.n_panels_x), 5, 40) : 16,
    n_panels_y: Number.isFinite(parameters.n_panels_y) ? clamp(Math.round(parameters.n_panels_y), 5, 30) : 8,
  };
}

function inferAgents(message, requestedAgent = 'master') {
  const text = String(message || '').toLowerCase();
  const agents = ['master_orchestrator'];

  if (
    text.includes('drag')
    || text.includes('lift')
    || text.includes('downforce')
    || text.includes('cfd')
    || text.includes('pressure')
    || text.includes('vlm')
  ) {
    agents.push('physics_validator');
    agents.push('ml_surrogate');
  }

  if (text.includes('optimize') || text.includes('optimization') || text.includes('qubo') || text.includes('qaoa')) {
    agents.push('quantum_optimizer');
  }

  if (text.includes('explain') || text.includes('recommend') || text.includes('plan')) {
    agents.push('analysis');
  }

  if (requestedAgent && requestedAgent !== 'master' && !agents.includes(requestedAgent)) {
    agents.push(requestedAgent);
  }

  return Array.from(new Set(agents));
}

function safeGetErrorMessage(error) {
  if (!error) {
    return 'unknown error';
  }

  if (error.response && error.response.data) {
    if (typeof error.response.data === 'string') {
      return error.response.data;
    }
    if (typeof error.response.data.detail === 'string') {
      return error.response.data.detail;
    }
    if (typeof error.response.data.message === 'string') {
      return error.response.data.message;
    }
  }

  return error.message || 'unknown error';
}

async function gatherServiceSnapshot(message, context) {
  const text = String(message || '').toLowerCase();
  const queryPhysics = text.includes('drag')
    || text.includes('lift')
    || text.includes('downforce')
    || text.includes('vlm')
    || text.includes('pressure')
    || text.includes('flow');
  const queryQuantum = text.includes('optimize')
    || text.includes('optimization')
    || text.includes('qubo')
    || text.includes('qaoa');

  const snapshot = {
    ml: null,
    physics: null,
    quantum: null,
    failures: [],
  };

  const mlPromise = mlClient.post(mlConfig.endpoints.predict, {
    mesh_id: context.mesh_id,
    parameters: context.parameters,
    use_cache: true,
    return_confidence: true,
  });

  const physicsPromise = queryPhysics
    ? physicsClient.post(physicsConfig.endpoints.vlmSolve, {
      geometry: context.geometry,
      velocity: context.parameters.velocity,
      alpha: context.parameters.alpha,
      yaw: context.parameters.yaw,
      rho: context.parameters.rho,
      n_panels_x: context.n_panels_x,
      n_panels_y: context.n_panels_y,
    })
    : Promise.resolve(null);

  const quantumPromise = queryQuantum
    ? quantumClient.post(quantumConfig.endpoints.qubo, {
      qubo_matrix: [
        [-0.24, 0.02, 0.02, 0.01],
        [0.02, -0.21, 0.015, 0.02],
        [0.02, 0.015, -0.19, 0.02],
        [0.01, 0.02, 0.02, -0.17],
      ],
      method: 'classical',
    })
    : Promise.resolve(null);

  const [mlResult, physicsResult, quantumResult] = await Promise.allSettled([
    mlPromise,
    physicsPromise,
    quantumPromise,
  ]);

  if (mlResult.status === 'fulfilled') {
    const payload = mlResult.value.data || {};
    snapshot.ml = {
      cl: Number.isFinite(payload.cl) ? toFixedNumber(payload.cl) : null,
      cd: Number.isFinite(payload.cd) ? toFixedNumber(payload.cd) : null,
      cm: Number.isFinite(payload.cm) ? toFixedNumber(payload.cm) : null,
      confidence: Number.isFinite(payload.confidence) ? toFixedNumber(payload.confidence, 3) : null,
      source: payload.source || null,
      cached: payload.cached === true,
    };
  } else {
    snapshot.failures.push(`ml: ${safeGetErrorMessage(mlResult.reason)}`);
  }

  if (physicsResult.status === 'fulfilled' && physicsResult.value) {
    const payload = physicsResult.value.data || {};
    snapshot.physics = {
      cl: Number.isFinite(payload.cl) ? toFixedNumber(payload.cl) : null,
      cd: Number.isFinite(payload.cd) ? toFixedNumber(payload.cd) : null,
      l_over_d: Number.isFinite(payload.l_over_d) ? toFixedNumber(payload.l_over_d) : null,
      n_panels: Number.isFinite(payload.n_panels) ? payload.n_panels : null,
    };
  } else if (physicsResult.status === 'rejected') {
    snapshot.failures.push(`physics: ${safeGetErrorMessage(physicsResult.reason)}`);
  }

  if (quantumResult.status === 'fulfilled' && quantumResult.value) {
    const payload = quantumResult.value.data || {};
    const selected = Array.isArray(payload.solution)
      ? payload.solution.filter((bit) => Number(bit) === 1).length
      : null;

    snapshot.quantum = {
      method: payload.method || null,
      cost: Number.isFinite(payload.cost) ? toFixedNumber(payload.cost, 5) : null,
      iterations: Number.isFinite(payload.iterations) ? payload.iterations : null,
      selected_variables: selected,
    };
  } else if (quantumResult.status === 'rejected') {
    snapshot.failures.push(`quantum: ${safeGetErrorMessage(quantumResult.reason)}`);
  }

  return snapshot;
}

function buildNarrative(message, context, agents, snapshot) {
  const text = String(message || '').toLowerCase();

  const lines = [];
  lines.push('I ran a quick multi-agent engineering pass with available services.');

  if (snapshot.ml || snapshot.physics || snapshot.quantum) {
    lines.push('');
    lines.push('Current snapshot:');

    if (snapshot.ml) {
      lines.push(`- ML surrogate: CL ${snapshot.ml.cl ?? 'n/a'}, CD ${snapshot.ml.cd ?? 'n/a'}, confidence ${snapshot.ml.confidence ?? 'n/a'}.`);
    }

    if (snapshot.physics) {
      lines.push(`- Physics (VLM): CL ${snapshot.physics.cl ?? 'n/a'}, CD ${snapshot.physics.cd ?? 'n/a'}, L/D ${snapshot.physics.l_over_d ?? 'n/a'}.`);
    }

    if (snapshot.quantum) {
      lines.push(`- Quantum proxy solve: method ${snapshot.quantum.method || 'n/a'}, cost ${snapshot.quantum.cost ?? 'n/a'}, selected vars ${snapshot.quantum.selected_variables ?? 'n/a'}.`);
    }
  }

  lines.push('');

  if (text.includes('optimiz')) {
    lines.push('Optimization guidance:');
    lines.push('- Prioritize nodes/surfaces that raise CL while constraining CD growth in the coupled loop.');
    lines.push('- Run 4-8 coupling iterations first, then increase to 10+ after residual behavior stabilizes.');
    lines.push('- Keep CFD adapter enabled for final candidate ranking; use proxy only for rapid screening.');
  } else if (text.includes('drag') || text.includes('lift') || text.includes('downforce')) {
    lines.push('Aerodynamic guidance:');
    lines.push('- Track CL, CD, and L/D together to avoid over-optimizing a single coefficient.');
    lines.push('- Compare baseline vs optimized CFD metrics and inspect per-iteration residuals for stability.');
    lines.push('- Validate selected VLM control points visually before geometry-level changes.');
  } else if (text.includes('plan') || text.includes('phase')) {
    lines.push('Phase 1 execution guidance:');
    lines.push('- Keep contracts stable first (simulation, ML, quantum, CFD adapter, chat APIs).');
    lines.push('- Close stubs and add deterministic fallbacks where hardware/services are optional.');
    lines.push('- Gate next steps with validation loops (unit checks + coupled simulation smoke tests).');
  } else {
    lines.push('Recommended next action:');
    lines.push('- Provide a target (max downforce, min drag, or balanced L/D) and I will return a focused run recipe.');
  }

  if (snapshot.failures.length > 0) {
    lines.push('');
    lines.push(`Service notes: ${snapshot.failures.join(' | ')}`);
  }

  lines.push('');
  lines.push(`Context: mesh=${context.mesh_id}, V=${toFixedNumber(context.parameters.velocity, 2)} m/s, alpha=${toFixedNumber(context.parameters.alpha, 2)} deg, yaw=${toFixedNumber(context.parameters.yaw, 2)} deg.`);

  return {
    content: lines.join('\n'),
    agents_involved: agents,
    snapshot,
  };
}

async function generateChatResponse({ message, agent = 'master', context = {}, messages = [] }) {
  const normalizedMessage = normalizeMessage(message || getLastUserMessage(messages));
  if (!normalizedMessage) {
    throw new Error('Message is required');
  }

  const normalizedContext = normalizeContext(context);
  const agents = inferAgents(normalizedMessage, agent);
  const snapshot = await gatherServiceSnapshot(normalizedMessage, normalizedContext);

  const narrative = buildNarrative(normalizedMessage, normalizedContext, agents, snapshot);

  return {
    agent,
    ...narrative,
    timestamp: new Date().toISOString(),
  };
}

function buildSseChunks(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const chunks = [];

  for (let i = 0; i < words.length; i += 4) {
    const slice = words.slice(i, i + 4).join(' ');
    chunks.push(`${slice}${i + 4 < words.length ? ' ' : ''}`);
  }

  return chunks.length > 0 ? chunks : [''];
}

/**
 * POST /api/claude/chat
 * Non-streaming chat response (legacy shape + structured payload)
 */
router.post('/chat', async (req, res, next) => {
  try {
    const { message, agent = 'master', context, messages } = req.body;

    const responsePayload = await generateChatResponse({
      message,
      agent,
      context,
      messages,
    });

    logger.info(`Claude local chat request served for agent=${agent}`);

    return res.json({
      success: true,
      response: responsePayload.content,
      agentsInvolved: responsePayload.agents_involved,
      data: responsePayload,
      timestamp: responsePayload.timestamp,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/claude/message
 * Hook-compatible single message endpoint
 */
router.post('/message', async (req, res, next) => {
  try {
    const { messages = [], context, model, temperature, max_tokens } = req.body;
    const message = getLastUserMessage(messages);

    const responsePayload = await generateChatResponse({
      message,
      agent: 'master',
      context,
      messages,
    });

    return res.json({
      content: responsePayload.content,
      metadata: {
        agent: responsePayload.agent,
        agents_involved: responsePayload.agents_involved,
        snapshot: responsePayload.snapshot,
        model: model || 'local-orchestrator-v1',
        temperature: Number.isFinite(temperature) ? temperature : 0.2,
        max_tokens: Number.isFinite(max_tokens) ? max_tokens : 512,
      },
      timestamp: responsePayload.timestamp,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/claude/stream
 * SSE-compatible streaming endpoint for frontend hooks
 */
router.post('/stream', async (req, res, next) => {
  try {
    const { messages = [], context } = req.body;
    const message = getLastUserMessage(messages);

    const responsePayload = await generateChatResponse({
      message,
      agent: 'master',
      context,
      messages,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) {
      res.flushHeaders();
    }

    const chunks = buildSseChunks(responsePayload.content);
    let index = 0;

    const interval = setInterval(() => {
      if (index >= chunks.length) {
        res.write('data: [DONE]\\n\\n');
        clearInterval(interval);
        res.end();
        return;
      }

      const event = {
        type: 'content_block_delta',
        delta: {
          text: chunks[index],
        },
      };

      res.write(`data: ${JSON.stringify(event)}\\n\\n`);
      index += 1;
    }, 18);

    req.on('close', () => {
      clearInterval(interval);
    });

    return undefined;
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/claude/agents
 * List available local orchestrator agents
 */
router.get('/agents', (req, res) => {
  res.json({
    success: true,
    data: {
      mode: 'local_orchestrator',
      agents: [
        {
          name: 'master_orchestrator',
          model: 'local-orchestrator-v1',
          status: 'ready',
          description: 'Routes user prompts to physics/ML/quantum services and composes engineering guidance.',
        },
        {
          name: 'ml_surrogate',
          model: 'empirical-or-onnx',
          status: 'ready',
          description: 'Fast aerodynamic coefficient predictions with cache-backed runtime stats.',
        },
        {
          name: 'quantum_optimizer',
          model: 'qubo-qaoa-service',
          status: 'ready',
          description: 'QUBO/QAOA problem solving for node and package-level optimization.',
        },
        {
          name: 'physics_validator',
          model: 'vlm-service',
          status: 'ready',
          description: 'VLM-based aerodynamic validation and node-level force extraction.',
        },
        {
          name: 'analysis',
          model: 'rule-based-local',
          status: 'ready',
          description: 'Structured recommendation layer over current simulation snapshots.',
        },
      ],
    },
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
