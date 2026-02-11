/**
 * Transient Routes
 * Scenario generation and deterministic transient aero-structural responses.
 */

const express = require('express');

const router = express.Router();

const SCENARIO_LIBRARY = Object.freeze({
  corner_exit_low: {
    initial_speed: 145,
    final_speed: 225,
    duration: 2.6,
    yaw_angle: 2.5,
    ride_height_delta: -4.0,
    disturbance: 0.12,
  },
  corner_exit_high: {
    initial_speed: 130,
    final_speed: 235,
    duration: 2.2,
    yaw_angle: 4.8,
    ride_height_delta: -6.5,
    disturbance: 0.22,
  },
  drs_cycle: {
    initial_speed: 285,
    final_speed: 312,
    duration: 3.1,
    yaw_angle: 0.8,
    ride_height_delta: -1.2,
    disturbance: 0.14,
  },
  kerb_strike: {
    initial_speed: 188,
    final_speed: 202,
    duration: 1.9,
    yaw_angle: 3.5,
    ride_height_delta: -9.0,
    disturbance: 0.28,
  },
  yaw_sweep: {
    initial_speed: 210,
    final_speed: 210,
    duration: 2.8,
    yaw_angle: 6.0,
    ride_height_delta: -3.0,
    disturbance: 0.18,
  },
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFixedNumber(value, decimals = 6) {
  return Number(Number(value).toFixed(decimals));
}

function resolveScenarioConfig(scenarioType, customConfig = {}) {
  if (scenarioType === 'custom') {
    return {
      initial_speed: Number.isFinite(customConfig.initial_speed) ? customConfig.initial_speed : 150,
      final_speed: Number.isFinite(customConfig.final_speed) ? customConfig.final_speed : 220,
      duration: Number.isFinite(customConfig.duration) ? clamp(customConfig.duration, 0.6, 12.0) : 2.5,
      yaw_angle: Number.isFinite(customConfig.yaw_angle) ? customConfig.yaw_angle : 3.0,
      ride_height_delta: Number.isFinite(customConfig.ride_height_delta) ? customConfig.ride_height_delta : -5.0,
      disturbance: 0.2,
    };
  }

  return SCENARIO_LIBRARY[scenarioType] || SCENARIO_LIBRARY.corner_exit_low;
}

function generateTransientResponse({ scenarioType, config }) {
  const dt = 0.05;
  const steps = Math.max(8, Math.round(config.duration / dt) + 1);
  const time = [];
  const downforce = [];
  const drag = [];
  const displacement = [];
  const modalEnergy = [];

  const speedDelta = config.final_speed - config.initial_speed;
  const rideHeightFactor = 1 + Math.abs(config.ride_height_delta) * 0.01;
  const yawPenalty = 1 + Math.abs(config.yaw_angle) * 0.03;
  const disturbance = clamp(config.disturbance, 0.05, 0.4);

  const baselineFinalDownforce = 12.5 * Math.pow(config.final_speed / 3.6, 2) * 0.01;
  let peakReduction = 0;

  for (let i = 0; i < steps; i += 1) {
    const t = i * dt;
    const alpha = config.duration > 0 ? t / config.duration : 1;
    const speed = config.initial_speed + speedDelta * Math.pow(alpha, 0.75);
    const velocityMs = speed / 3.6;

    const oscillation = Math.sin((t / Math.max(config.duration, 0.1)) * Math.PI * 4);
    const kerbPulse = scenarioType === 'kerb_strike' ? Math.exp(-Math.pow((t - config.duration * 0.4) / 0.16, 2)) : 0;
    const drsRelief = scenarioType === 'drs_cycle' ? Math.sin(alpha * Math.PI) * 0.12 : 0;

    const nominalDownforce = 12.5 * velocityMs * velocityMs * 0.01 * rideHeightFactor;
    const disturbanceLoss = 1 - disturbance * (0.22 + 0.5 * Math.abs(oscillation) + kerbPulse * 0.6 + drsRelief);
    const downforcePoint = nominalDownforce * disturbanceLoss;

    const dragPoint = 2.4 * velocityMs * velocityMs * 0.01 * yawPenalty * (1 + disturbance * 0.12 * Math.abs(oscillation));
    const displacementPoint = (
      0.0018 * rideHeightFactor * (0.6 + disturbance * 1.8)
      * (Math.sin(alpha * Math.PI * 6) + 0.45 * kerbPulse)
      * Math.exp(-alpha * 0.5)
    );
    const modalEnergyPoint = (
      14
      * Math.pow(Math.abs(displacementPoint) * 1000, 1.22)
      * (1 + 0.18 * Math.abs(config.yaw_angle))
    );

    peakReduction = Math.max(
      peakReduction,
      clamp((baselineFinalDownforce - downforcePoint) / Math.max(baselineFinalDownforce, 1e-6), 0, 0.95)
    );

    time.push(toFixedNumber(t, 3));
    downforce.push(toFixedNumber(downforcePoint, 4));
    drag.push(toFixedNumber(dragPoint, 4));
    displacement.push(toFixedNumber(displacementPoint, 6));
    modalEnergy.push(toFixedNumber(modalEnergyPoint, 5));
  }

  const maxModal = Math.max(...modalEnergy);
  const flutterMargin = toFixedNumber(clamp(2.05 - maxModal / 75, 0.95, 2.5), 3);

  return {
    scenario_type: scenarioType,
    config,
    time,
    downforce,
    drag,
    displacement,
    modal_energy: modalEnergy,
    peak_downforce_reduction: toFixedNumber(peakReduction, 4),
    flutter_margin: flutterMargin,
    generated_at: new Date().toISOString(),
  };
}

router.post('/run-scenario', (req, res) => {
  const scenarioType = String(req.body?.scenario_type || 'corner_exit_low').toLowerCase();
  const config = resolveScenarioConfig(scenarioType, req.body?.config || {});
  const response = generateTransientResponse({ scenarioType, config });
  res.json(response);
});

router.post('/generate-scenarios', (req, res) => {
  const scenarios = Array.isArray(req.body?.scenarios) && req.body.scenarios.length > 0
    ? req.body.scenarios
    : Object.keys(SCENARIO_LIBRARY);

  const generated = scenarios.map((scenarioName, idx) => {
    const scenarioType = String(scenarioName).toLowerCase();
    const config = resolveScenarioConfig(scenarioType, {});
    return {
      id: `scenario_${idx + 1}_${scenarioType}`,
      scenario_type: scenarioType,
      duration: config.duration,
      status: 'generated',
    };
  });

  res.json({
    total: generated.length,
    scenarios: generated,
    timestamp: new Date().toISOString(),
  });
});

router.get('/library', (_req, res) => {
  res.json({
    available_scenarios: Object.keys(SCENARIO_LIBRARY),
    count: Object.keys(SCENARIO_LIBRARY).length,
  });
});

module.exports = router;
