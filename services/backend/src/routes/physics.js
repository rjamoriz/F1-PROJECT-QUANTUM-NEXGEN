/**
 * Physics Engine Routes
 * Proxy routes to the Physics Engine microservice (VLM/Panel methods)
 */

const express = require('express');
const router = express.Router();
const { createServiceClient, cachedRequest, healthCheck } = require('../utils/serviceClient');
const { physics: physicsConfig } = require('../config/services');
const logger = require('../utils/logger');

// Create physics service client
const physicsClient = createServiceClient(
  'Physics Engine',
  physicsConfig.baseUrl,
  physicsConfig.timeout
);

/**
 * POST /api/physics/vlm/solve
 * Solve aerodynamics using VLM
 */
router.post('/vlm/solve', async (req, res, next) => {
  try {
    logger.info('VLM solve request received');

    const response = await physicsClient.post(
      physicsConfig.endpoints.vlmSolve,
      req.body
    );

    res.json({
      success: true,
      data: response.data,
      service: 'physics-engine',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/physics/vlm/sweep
 * Perform angle of attack sweep
 */
router.post('/vlm/sweep', async (req, res, next) => {
  try {
    logger.info('VLM sweep request received');

    const response = await physicsClient.post(
      physicsConfig.endpoints.vlmSweep,
      req.body
    );

    res.json({
      success: true,
      data: response.data,
      service: 'physics-engine',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/physics/vlm/validate
 * Validate VLM solver
 */
router.get('/vlm/validate', async (req, res, next) => {
  try {
    logger.info('VLM validation request received');

    // Cache validation results for 1 hour
    const cacheKey = 'physics:vlm:validation';
    const result = await cachedRequest(
      physicsClient,
      { method: 'GET', url: physicsConfig.endpoints.vlmValidate },
      cacheKey,
      3600
    );

    res.json({
      success: true,
      data: result.data,
      cached: result.cached,
      service: 'physics-engine',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/physics/v1/flow-field
 * Compatibility proxy for visualization flow-field payloads.
 */
router.post('/v1/flow-field', async (req, res, next) => {
  try {
    logger.info('Flow-field compatibility request received');

    const response = await physicsClient.post(
      physicsConfig.endpoints.flowField,
      req.body
    );

    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/physics/v1/panel-solve
 * Compatibility proxy for panel-method visualization payloads.
 */
router.post('/v1/panel-solve', async (req, res, next) => {
  try {
    logger.info('Panel-solve compatibility request received');

    const response = await physicsClient.post(
      physicsConfig.endpoints.panelSolve,
      req.body
    );

    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/physics/vlm/batch-simulate
 * Compatibility proxy for synthetic batch VLM generation.
 */
router.post('/vlm/batch-simulate', async (req, res, next) => {
  try {
    logger.info('VLM batch-simulate request received');

    const response = await physicsClient.post(
      physicsConfig.endpoints.vlmBatchSimulate,
      req.body
    );

    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/physics/health
 * Check physics service health
 */
router.get('/health', async (req, res) => {
  const health = await healthCheck(physicsClient, physicsConfig.endpoints.health);
  
  res.status(health.healthy ? 200 : 503).json({
    service: 'physics-engine',
    ...health,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
