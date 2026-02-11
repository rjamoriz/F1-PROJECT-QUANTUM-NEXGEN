/**
 * Multi-Fidelity Routes
 * Orchestrates low -> medium -> high fidelity evaluation chain.
 */

const express = require('express');
const axios = require('axios');
const { createServiceClient } = require('../utils/serviceClient');
const { physics: physicsConfig, ml: mlConfig } = require('../config/services');
const logger = require('../utils/logger');

const router = express.Router();

const physicsClient = createServiceClient(
  'Physics Engine',
  physicsConfig.baseUrl,
  physicsConfig.timeout
);
const mlClient = createServiceClient(
  'ML Surrogate',
  mlConfig.baseUrl,
  mlConfig.timeout
);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toSafeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function toDurationSeconds(startedAtMs) {
  return Number(((Date.now() - startedAtMs) / 1000).toFixed(3));
}

function mapAeroResults(raw = {}) {
  const cl = toSafeNumber(raw.cl ?? raw.Cl, 0);
  const cd = Math.max(toSafeNumber(raw.cd ?? raw.Cd, 1e-6), 1e-6);
  const lOverD = toSafeNumber(raw.l_over_d ?? raw.L_D, cl / cd);

  return {
    Cl: Number(cl.toFixed(6)),
    Cd: Number(cd.toFixed(6)),
    L_D: Number(lOverD.toFixed(6)),
  };
}

function stageTemplate(name, cost) {
  return {
    name,
    status: 'pending',
    confidence: null,
    time: null,
    cost,
    results: null,
    decision: 'PENDING',
    reason: null,
  };
}

function buildRecommendation(finalResult, threshold, autoEscalate) {
  if (!finalResult) {
    return 'Evaluation failed before any stage produced usable aerodynamic metrics.';
  }
  if (finalResult.fidelityLevel === 'high') {
    return 'High-fidelity coupled evaluation completed and is recommended for design sign-off.';
  }
  if (finalResult.fidelityLevel === 'medium') {
    return `Medium-fidelity validation accepted at confidence ${(finalResult.confidence * 100).toFixed(1)}% (threshold ${(threshold * 100).toFixed(1)}%).`;
  }
  if (autoEscalate) {
    return `Low-fidelity surrogate accepted at confidence ${(finalResult.confidence * 100).toFixed(1)}% with auto-escalation enabled.`;
  }
  return `Low-fidelity surrogate accepted because auto escalation is disabled (confidence ${(finalResult.confidence * 100).toFixed(1)}%).`;
}

router.post('/evaluate', async (req, res, next) => {
  const totalStartMs = Date.now();

  try {
    logger.info('Multi-fidelity evaluation request received');

    const meshId = req.body.meshId || 'wing_v3.2';
    const velocityInput = toSafeNumber(req.body.velocity, 250);
    const velocity = velocityInput > 120 ? velocityInput / 3.6 : velocityInput;
    const yaw = toSafeNumber(req.body.yaw, 0);
    const alpha = toSafeNumber(req.body.alpha, 4.5);
    const rho = toSafeNumber(req.body.rho, 1.225);
    const confidenceThreshold = clamp(toSafeNumber(req.body.confidenceThreshold, 0.9), 0.5, 0.99);
    const autoEscalate = req.body.autoEscalate !== false;

    const geometry = {
      span: toSafeNumber(req.body.geometry?.span, 1.2),
      chord: toSafeNumber(req.body.geometry?.chord, 0.28),
      twist: toSafeNumber(req.body.geometry?.twist, -1.0),
      dihedral: toSafeNumber(req.body.geometry?.dihedral, 0.0),
      sweep: toSafeNumber(req.body.geometry?.sweep, 6.0),
      taper_ratio: toSafeNumber(req.body.geometry?.taper_ratio, 0.75),
    };

    const stages = [
      stageTemplate('Low-Fidelity (ML Surrogate)', 0.001),
      stageTemplate('Medium-Fidelity (VLM)', 0.1),
      stageTemplate('High-Fidelity (Coupled Simulation)', 10.0),
    ];

    let finalResult = null;

    // Stage 1: ML surrogate
    const lowStartMs = Date.now();
    try {
      const mlResponse = await mlClient.post(mlConfig.endpoints.predict, {
        mesh_id: meshId,
        parameters: {
          velocity,
          alpha,
          yaw,
          rho,
        },
        use_cache: true,
        return_confidence: true,
      });
      const lowResults = mapAeroResults(mlResponse.data);
      const lowConfidence = clamp(toSafeNumber(mlResponse.data?.confidence, 0.45), 0, 1);

      stages[0] = {
        ...stages[0],
        status: 'completed',
        confidence: Number(lowConfidence.toFixed(4)),
        time: toDurationSeconds(lowStartMs),
        results: lowResults,
      };

      if (lowConfidence >= confidenceThreshold || !autoEscalate) {
        stages[0].decision = 'ACCEPT';
        stages[0].reason = lowConfidence >= confidenceThreshold
          ? `High confidence (${(lowConfidence * 100).toFixed(1)}%) exceeds threshold.`
          : 'Auto escalation disabled; accepted low-fidelity output.';

        stages[1] = {
          ...stages[1],
          status: 'skipped',
          decision: 'SKIPPED',
          reason: 'Low-fidelity stage accepted.',
        };
        stages[2] = {
          ...stages[2],
          status: 'skipped',
          decision: 'SKIPPED',
          reason: 'High-fidelity stage not required.',
        };

        finalResult = {
          ...lowResults,
          fidelityLevel: 'low',
          confidence: Number(lowConfidence.toFixed(4)),
          validated: lowConfidence >= confidenceThreshold,
        };
      } else {
        stages[0].decision = 'ESCALATE';
        stages[0].reason = `Confidence ${(lowConfidence * 100).toFixed(1)}% below threshold ${(confidenceThreshold * 100).toFixed(1)}%.`;
      }
    } catch (error) {
      stages[0] = {
        ...stages[0],
        status: 'failed',
        time: toDurationSeconds(lowStartMs),
        decision: autoEscalate ? 'ESCALATE' : 'REJECT',
        reason: `ML surrogate failed: ${error.message}`,
      };
    }

    // Stage 2: VLM
    if (!finalResult) {
      const mediumStartMs = Date.now();
      try {
        const physicsResponse = await physicsClient.post(physicsConfig.endpoints.vlmSolve, {
          geometry,
          velocity,
          alpha,
          yaw,
          rho,
          n_panels_x: clamp(Math.round(toSafeNumber(req.body.n_panels_x, 20)), 5, 40),
          n_panels_y: clamp(Math.round(toSafeNumber(req.body.n_panels_y, 10)), 5, 30),
        });

        const mediumResults = mapAeroResults(physicsResponse.data);
        const mediumConfidence = clamp(
          0.68
          + Math.min(0.2, Math.max(0, (mediumResults.L_D - 3.0) / 10))
          - Math.min(0.12, Math.abs(yaw) * 0.01),
          0.45,
          0.98
        );

        stages[1] = {
          ...stages[1],
          status: 'completed',
          confidence: Number(mediumConfidence.toFixed(4)),
          time: toDurationSeconds(mediumStartMs),
          results: mediumResults,
        };

        if (mediumConfidence >= confidenceThreshold || !autoEscalate) {
          stages[1].decision = 'ACCEPT';
          stages[1].reason = mediumConfidence >= confidenceThreshold
            ? `VLM confidence ${(mediumConfidence * 100).toFixed(1)}% exceeds threshold.`
            : 'Auto escalation disabled; accepted medium-fidelity output.';

          stages[2] = {
            ...stages[2],
            status: 'skipped',
            decision: 'SKIPPED',
            reason: 'Medium-fidelity stage accepted.',
          };

          finalResult = {
            ...mediumResults,
            fidelityLevel: 'medium',
            confidence: Number(mediumConfidence.toFixed(4)),
            validated: mediumConfidence >= confidenceThreshold,
          };
        } else {
          stages[1].decision = 'ESCALATE';
          stages[1].reason = `VLM confidence ${(mediumConfidence * 100).toFixed(1)}% below threshold.`;
        }
      } catch (error) {
        stages[1] = {
          ...stages[1],
          status: 'failed',
          time: toDurationSeconds(mediumStartMs),
          decision: autoEscalate ? 'ESCALATE' : 'REJECT',
          reason: `VLM stage failed: ${error.message}`,
        };
      }
    }

    // Stage 3: coupled simulation
    if (!finalResult && autoEscalate) {
      const highStartMs = Date.now();
      try {
        const backendBase = process.env.BACKEND_SELF_URL || `http://127.0.0.1:${process.env.PORT || 3001}`;
        const coupledResponse = await axios.post(`${backendBase}/api/simulation/run`, {
          geometry,
          conditions: {
            velocity,
            alpha,
            yaw,
            rho,
            n_panels_x: clamp(Math.round(toSafeNumber(req.body.n_panels_x, 20)), 5, 40),
            n_panels_y: clamp(Math.round(toSafeNumber(req.body.n_panels_y, 10)), 5, 30),
          },
          optimization: true,
          use_quantum: true,
          use_ml_surrogate: true,
          use_cfd_adapter: true,
          coupling_iterations: clamp(Math.round(toSafeNumber(req.body.high_fidelity_iterations, 4)), 1, 12),
          async_mode: false,
        }, {
          timeout: 120000,
        });

        const simulationData = coupledResponse?.data?.data || {};
        const highRaw =
          simulationData?.optimization?.cfd_proxy_optimized
          || simulationData?.optimization?.optimized_metrics
          || simulationData?.baseline?.cfd_proxy
          || {};
        const highResults = mapAeroResults(highRaw);
        const simulationStatus = simulationData?.status || 'completed';
        const highConfidence = simulationStatus === 'completed'
          ? 0.97
          : simulationStatus === 'degraded'
            ? 0.84
            : 0.45;

        stages[2] = {
          ...stages[2],
          status: simulationStatus === 'failed' ? 'failed' : 'completed',
          confidence: Number(highConfidence.toFixed(4)),
          time: toDurationSeconds(highStartMs),
          results: highResults,
          decision: simulationStatus === 'failed' ? 'REJECT' : 'ACCEPT',
          reason: simulationStatus === 'failed'
            ? 'Coupled high-fidelity simulation failed.'
            : `Coupled simulation finished with status "${simulationStatus}".`,
        };

        finalResult = {
          ...highResults,
          fidelityLevel: 'high',
          confidence: Number(highConfidence.toFixed(4)),
          validated: simulationStatus === 'completed',
        };
      } catch (error) {
        stages[2] = {
          ...stages[2],
          status: 'failed',
          time: toDurationSeconds(highStartMs),
          decision: 'REJECT',
          reason: `High-fidelity stage failed: ${error.message}`,
        };
      }
    } else if (!finalResult) {
      stages[2] = {
        ...stages[2],
        status: 'skipped',
        decision: 'SKIPPED',
        reason: 'Auto escalation is disabled.',
      };
    }

    const totalTime = Number(stages.reduce((sum, stage) => sum + toSafeNumber(stage.time, 0), 0).toFixed(3));
    const totalCost = Number(
      stages
        .filter((stage) => stage.status === 'completed')
        .reduce((sum, stage) => sum + toSafeNumber(stage.cost, 0), 0)
        .toFixed(3)
    );

    const payload = {
      stages,
      finalResult: {
        ...(finalResult || { Cl: 0, Cd: 0, L_D: 0, confidence: 0, fidelityLevel: 'none', validated: false }),
        totalTime,
        totalCost,
      },
      recommendation: buildRecommendation(finalResult, confidenceThreshold, autoEscalate),
      metadata: {
        meshId,
        velocity_mps: Number(velocity.toFixed(4)),
        yaw_deg: Number(yaw.toFixed(4)),
        threshold: confidenceThreshold,
        autoEscalate,
        elapsed_total_s: Number(toDurationSeconds(totalStartMs).toFixed(3)),
      },
    };

    return res.json({
      success: true,
      data: payload,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
