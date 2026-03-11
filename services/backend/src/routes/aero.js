/**
 * Aero Optimization Routes
 * 
 * Quantum-ready aero optimization loop orchestration:
 * 1. Generate candidates from design space
 * 2. ML batch predict (cl, cd, balance_proxy, stall_risk)
 * 3. Build QUBO from quadratic surrogate
 * 4. Quantum solve (QAOA)
 * 5. Decode top-k candidates
 * 6. VLM validate top-k
 * 7. Save to MongoDB and return result
 */

const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const OptimizationRun = require('../models/OptimizationRun');
const {
  generateCandidates,
  buildQubo,
  decodeSolutionToTopK,
  rankCandidates,
} = require('../utils/aeroOptimization');

const router = express.Router();

// Service endpoints from environment
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml-surrogate:8000';
const QUANTUM_SERVICE_URL = process.env.QUANTUM_SERVICE_URL || 'http://quantum-optimizer:8002';
const PHYSICS_SERVICE_URL = process.env.PHYSICS_SERVICE_URL || 'http://physics-engine:8001';

// Timeouts (ms)
const ML_TIMEOUT = parseInt(process.env.ML_TIMEOUT_MS, 10) || 30000;
const QUANTUM_TIMEOUT = parseInt(process.env.QUANTUM_TIMEOUT_MS, 10) || 120000;
const PHYSICS_TIMEOUT = parseInt(process.env.PHYSICS_TIMEOUT_MS, 10) || 60000;

/**
 * POST /api/v1/aero/optimize
 * 
 * Orchestrate quantum-ready aero optimization loop
 */
router.post('/optimize', async (req, res, next) => {
  const startTime = Date.now();
  const runId = uuidv4();
  
  try {
    const {
      design_space,
      flow_conditions,
      objectives = {},
      constraints = {},
      num_candidates = 64,
      candidate_generation_method = 'lhs',
      top_k = 3,
      quantum_method = 'qaoa',
      quantum_backend = 'aer_simulator',
      quantum_shots = 1024,
    } = req.body;
    
    logger.info(`[${runId}] Starting aero optimization: ${num_candidates} candidates, top-${top_k}, method=${quantum_method}`);
    
    // Validate required fields
    if (!design_space || !flow_conditions) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: design_space, flow_conditions',
      });
    }
    
    const timings = {};
    
    // ===== STEP 1: Generate Candidates =====
    const t1Start = Date.now();
    const candidates = generateCandidates(design_space, num_candidates, candidate_generation_method);
    timings.candidate_generation_ms = Date.now() - t1Start;
    
    logger.info(`[${runId}] Generated ${candidates.length} candidates in ${timings.candidate_generation_ms}ms`);
    
    // ===== STEP 2: ML Batch Predict =====
    const t2Start = Date.now();
    const mlRequests = candidates.map(c => ({
      mesh_id: `candidate_${c.id}`,
      parameters: {
        ...c.parameters,
        ...flow_conditions,
      },
      use_cache: true,
      return_confidence: true,
    }));
    
    let mlResponse;
    try {
      const mlResult = await axios.post(
        `${ML_SERVICE_URL}/predict/batch`,
        { requests: mlRequests, batch_size: 32 },
        { timeout: ML_TIMEOUT }
      );
      mlResponse = mlResult.data;
      timings.ml_inference_ms = mlResponse.total_inference_time_ms || (Date.now() - t2Start);
    } catch (mlError) {
      logger.error(`[${runId}] ML service error: ${mlError.message}`);
      throw new Error(`ML prediction failed: ${mlError.message}`);
    }
    
    if (!mlResponse.success || mlResponse.results.length !== candidates.length) {
      throw new Error(`ML batch prediction incomplete: got ${mlResponse.results.length}/${candidates.length} results`);
    }
    
    logger.info(`[${runId}] ML predictions complete: ${mlResponse.count} results in ${timings.ml_inference_ms}ms`);
    
    // Attach ML scores to candidates
    const mlScores = candidates.map((c, idx) => ({
      id: c.id,
      ...mlResponse.results[idx],
    }));
    
    // ===== STEP 3: Build QUBO =====
    const t3Start = Date.now();
    const quboData = buildQubo(mlScores, objectives, constraints.penalty_weight || 10.0);
    timings.qubo_construction_ms = Date.now() - t3Start;
    
    logger.info(`[${runId}] QUBO built: ${quboData.n_variables} variables in ${timings.qubo_construction_ms}ms`);
    
    // ===== STEP 4: Quantum Solve =====
    const t4Start = Date.now();
    let quantumResponse;
    try {
      const quantumResult = await axios.post(
        `${QUANTUM_SERVICE_URL}/qubo`,
        {
          qubo_matrix: quboData.Q_matrix,
          method: 'auto', // Let service choose quantum vs classical based on problem size
          constraints: {}
        },
        { timeout: QUANTUM_TIMEOUT }
      );
      quantumResponse = quantumResult.data;
      timings.quantum_solve_ms = Date.now() - t4Start;
    } catch (quantumError) {
      logger.error(`[${runId}] Quantum service error: ${quantumError.message}`);
      throw new Error(`Quantum optimization failed: ${quantumError.message}`);
    }
    
    if (!quantumResponse.success) {
      throw new Error(`Quantum solver failed: ${quantumResponse.error || 'Unknown error'}`);
    }
    
    logger.info(`[${runId}] Quantum solve complete: cost=${quantumResponse.cost.toFixed(4)}, method=${quantumResponse.method}, iterations=${quantumResponse.iterations || 'N/A'} in ${timings.quantum_solve_ms}ms`);
    
    // ===== STEP 5: Decode Top-K Candidates =====
    const t5Start = Date.now();
    const topKIds = decodeSolutionToTopK(quantumResponse.solution, quboData, mlScores, top_k);
    timings.solution_decoding_ms = Date.now() - t5Start;
    
    logger.info(`[${runId}] Decoded top-${top_k}: ${topKIds.join(', ')} in ${timings.solution_decoding_ms}ms`);
    
    // ===== STEP 6: VLM Validate Top-K =====
    const t6Start = Date.now();
    const topKCandidates = candidates.filter(c => topKIds.includes(c.id));
    const vlmRequests = topKCandidates.map(c => ({
      geometry: {
        span: c.parameters.span || flow_conditions.span || 1.8,
        chord: c.parameters.chord || flow_conditions.chord || 0.3,
        panels_span: 60,
        panels_chord: 40,
        aoa_deg: c.parameters.aoa_deg || flow_conditions.aoa_deg || 5.0,
        ground_height: flow_conditions.ground_height || 0.05,
      },
      flow: {
        velocity: flow_conditions.velocity || 50.0,
        density: flow_conditions.density || 1.225,
      },
      use_iterative: true,
    }));
    
    let vlmResponse;
    try {
      const vlmResult = await axios.post(
        `${PHYSICS_SERVICE_URL}/vlm/solve/batch`,
        { requests: vlmRequests, use_iterative: true },
        { timeout: PHYSICS_TIMEOUT }
      );
      vlmResponse = vlmResult.data;
      timings.vlm_validation_ms = vlmResponse.compute_time_ms || (Date.now() - t6Start);
    } catch (vlmError) {
      logger.warn(`[${runId}] VLM validation error (non-critical): ${vlmError.message}`);
      vlmResponse = { success: false, n_completed: 0, results: [], errors: [vlmError.message] };
      timings.vlm_validation_ms = Date.now() - t6Start;
    }
    
    logger.info(`[${runId}] VLM validation: ${vlmResponse.n_completed}/${topKCandidates.length} completed in ${timings.vlm_validation_ms}ms`);
    
    // ===== STEP 7: Rank and Select Best =====
    const rankedCandidates = rankCandidates(mlScores, objectives);
    const bestCandidate = rankedCandidates[0];
    
    const bestDesign = candidates.find(c => c.id === bestCandidate.id);
    
    // Attach VLM validation if available
    const vlmValidationData = vlmResponse.success && vlmResponse.results.length > 0
      ? vlmResponse.results.map((result, idx) => ({
          candidate_id: topKIds[idx],
          cl_vlm: result.cl,
          cd_vlm: result.cd,
          converged: result.converged,
        }))
      : [];
    
    // ===== STEP 8: Save to MongoDB =====
    const totalComputeTime = Date.now() - startTime;
    
    const optimizationRun = new OptimizationRun({
      runId,
      request: {
        design_space,
        flow_conditions,
        objectives,
        constraints,
        num_candidates,
        top_k,
        quantum_method,
      },
      candidates: {
        count: candidates.length,
        method: candidate_generation_method,
        data: candidates.slice(0, 20), // Store first 20 for audit
      },
      mlScores: mlScores.slice(0, 20), // Store first 20
      qubo: {
        n_variables: quboData.n_variables,
        Q_matrix: quboData.Q_matrix.slice(0, 100), // Store first 100 elements
        penalty_weight: quboData.penalty_weight,
      },
      quantumSolution: {
        method: quantumResponse.method || quantum_method,
        solution: quantumResponse.solution,
        cost: quantumResponse.cost,
        iterations: quantumResponse.iterations || null,
        success: quantumResponse.success || true,
        backend: quantum_backend,
        shots: quantum_shots,
      },
      vlmValidation: vlmValidationData,
      result: {
        design: bestDesign,
        performance: {
          cl_ml: bestCandidate.cl,
          cd_ml: bestCandidate.cd,
          cm_ml: bestCandidate.cm,
          balance_proxy: bestCandidate.balance_proxy,
          stall_risk: bestCandidate.stall_risk,
          composite_score: bestCandidate.composite_score,
        },
        validation: vlmValidationData.length > 0 ? vlmValidationData[0] : null,
        top_k_ids: topKIds,
      },
      computeTimeMs: totalComputeTime,
      timingBreakdown: timings,
      userId: req.user?.id || 'system',
    });
    
    try {
      await optimizationRun.save();
      logger.info(`[${runId}] Saved to MongoDB`);
    } catch (dbError) {
      logger.error(`[${runId}] MongoDB save error: ${dbError.message}`);
      // Continue anyway - result is still valid
    }
    
    // ===== STEP 9: Return Result =====
    const response = {
      success: true,
      run_id: runId,
      result: {
        design: bestDesign,
        performance: {
          cl: bestCandidate.cl,
          cd: bestCandidate.cd,
          cm: bestCandidate.cm,
          balance_proxy: bestCandidate.balance_proxy,
          stall_risk: bestCandidate.stall_risk,
          composite_score: bestCandidate.composite_score,
        },
        validation: vlmValidationData.length > 0 ? vlmValidationData[0] : null,
        top_k: topKIds,
      },
      metadata: {
        total_candidates: candidates.length,
        quantum_cost: quantumResponse.cost,
        quantum_method: quantumResponse.method,
        quantum_iterations: quantumResponse.iterations || null,
        compute_time_ms: totalComputeTime,
        timing_breakdown: timings,
      },
    };
    
    logger.info(`[${runId}] Optimization complete in ${totalComputeTime}ms`);
    res.json(response);
    
  } catch (error) {
    logger.error(`[${runId}] Optimization failed: ${error.message}`);
    next(error);
  }
});

/**
 * GET /api/v1/aero/optimize/recent
 * 
 * Get recent optimization runs
 */
router.get('/optimize/recent', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const userId = req.user?.id;
    
    const runs = await OptimizationRun.findRecent(limit, userId);
    
    res.json({
      success: true,
      count: runs.length,
      runs: runs,  // Already lean objects with selected fields
    });
  } catch (error) {
    logger.error(`Recent optimizations error: ${error.message}`);
    next(error);
  }
});

/**
 * GET /api/v1/aero/optimize/:runId
 * 
 * Retrieve optimization run by ID
 */
router.get('/optimize/:runId', async (req, res, next) => {
  try {
    const { runId } = req.params;
    
    const run = await OptimizationRun.findOne({ runId });
    
    if (!run) {
      return res.status(404).json({
        success: false,
        error: 'Optimization run not found',
      });
    }
    
    res.json({
      success: true,
      run: run.getSummary(),
    });
  } catch (error) {
    logger.error(`Retrieve optimization error: ${error.message}`);
    next(error);
  }
});

/**
 * GET /api/v1/aero/health
 * 
 * Health check for aero optimization service
 */
router.get('/health', async (req, res) => {
  const health = {
    service: 'aero-optimization',
    status: 'operational',
    timestamp: new Date().toISOString(),
    dependencies: {
      ml_service: 'unknown',
      quantum_service: 'unknown',
      physics_service: 'unknown',
    },
  };
  
  // Quick health checks (with timeouts)
  const checkService = async (name, url) => {
    try {
      await axios.get(`${url}/health`, { timeout: 3000 });
      return 'healthy';
    } catch {
      return 'unhealthy';
    }
  };
  
  const [mlHealth, quantumHealth, physicsHealth] = await Promise.all([
    checkService('ml', ML_SERVICE_URL),
    checkService('quantum', QUANTUM_SERVICE_URL),
    checkService('physics', PHYSICS_SERVICE_URL),
  ]);
  
  health.dependencies.ml_service = mlHealth;
  health.dependencies.quantum_service = quantumHealth;
  health.dependencies.physics_service = physicsHealth;
  
  const allHealthy = Object.values(health.dependencies).every(s => s === 'healthy');
  health.status = allHealthy ? 'operational' : 'degraded';
  
  res.json(health);
});

module.exports = router;
