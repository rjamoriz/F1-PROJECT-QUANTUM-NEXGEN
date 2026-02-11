/**
 * Aeroelastic Routes
 * Deterministic flutter and mode-shape datasets for UI and integration contracts.
 */

const express = require('express');

const router = express.Router();

const CONFIG_SCALE = Object.freeze({
  baseline: { stiffness: 1.0, damping: 1.0, mass: 1.0 },
  stiffened: { stiffness: 1.16, damping: 1.08, mass: 1.06 },
  lightweight: { stiffness: 0.9, damping: 0.92, mass: 0.9 },
  optimized: { stiffness: 1.22, damping: 1.14, mass: 0.97 },
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFixedNumber(value, decimals = 4) {
  return Number(Number(value).toFixed(decimals));
}

function getProfile(configKey = 'baseline') {
  return CONFIG_SCALE[configKey] || CONFIG_SCALE.baseline;
}

function buildModes(configKey = 'baseline') {
  const profile = getProfile(configKey);

  const baseModes = [
    { id: 0, type: 'bending', frequency: 25.3, damping: 0.021, description: '1st Bending Mode' },
    { id: 1, type: 'torsion', frequency: 42.7, damping: 0.024, description: '1st Torsion Mode' },
    { id: 2, type: 'bending', frequency: 58.1, damping: 0.023, description: '2nd Bending Mode' },
    { id: 3, type: 'coupled', frequency: 73.5, damping: 0.026, description: 'Bending-Torsion Coupled' },
    { id: 4, type: 'local', frequency: 95.2, damping: 0.03, description: 'Endplate Local Mode' },
  ];

  return baseModes.map((mode, idx) => {
    const frequencyScale = (profile.stiffness / Math.sqrt(profile.mass)) * (1 + idx * 0.01);
    const dampingScale = profile.damping * (1 - idx * 0.02);
    return {
      ...mode,
      frequency: toFixedNumber(mode.frequency * frequencyScale, 3),
      damping: toFixedNumber(clamp(mode.damping * dampingScale, 0.006, 0.08), 5),
    };
  });
}

function buildVgDiagram(configKey = 'baseline') {
  const profile = getProfile(configKey);
  const velocities = [];
  const criticalShift = (profile.stiffness - 1) * 45 + (profile.damping - 1) * 30 - (profile.mass - 1) * 20;
  const criticalSpeed = clamp(285 + criticalShift, 220, 345);

  for (let velocity = 100; velocity <= 350; velocity += 10) {
    const normalized = (velocity - 100) / 250;
    const mode1 = 0.026 * profile.damping - normalized * (0.032 / profile.stiffness);
    const mode2 = 0.031 * profile.damping - normalized * (0.028 / profile.stiffness);
    const mode3 = 0.028 * profile.damping - normalized * (0.034 / profile.stiffness);

    velocities.push({
      velocity,
      mode1: toFixedNumber(mode1, 5),
      mode2: toFixedNumber(mode2, 5),
      mode3: toFixedNumber(mode3, 5),
    });
  }

  return {
    vg_diagram: velocities,
    critical_speed_kmh: toFixedNumber(criticalSpeed, 2),
  };
}

function safetyStatus(flutterMargin) {
  if (flutterMargin >= 1.5) return 'SAFE';
  if (flutterMargin >= 1.2) return 'CAUTION';
  return 'CRITICAL';
}

router.get('/modes', (req, res) => {
  const configKey = String(req.query.config || 'baseline').toLowerCase();
  const modes = buildModes(configKey);

  res.json({
    configuration: configKey,
    modes,
    generated_at: new Date().toISOString(),
  });
});

router.get('/flutter-analysis', (req, res) => {
  const configKey = String(req.query.config || 'baseline').toLowerCase();
  const modes = buildModes(configKey);
  const vgResult = buildVgDiagram(configKey);

  const maxSpeed = 235;
  const flutterSpeed = vgResult.critical_speed_kmh;
  const flutterMargin = toFixedNumber(flutterSpeed / maxSpeed, 3);
  const criticalMode = modes[0];

  res.json({
    configuration: configKey,
    max_speed: maxSpeed,
    flutter_speed: flutterSpeed,
    flutter_margin: flutterMargin,
    safety_status: safetyStatus(flutterMargin),
    critical_mode: `Mode ${criticalMode.id + 1}: ${criticalMode.description}`,
    critical_frequency: criticalMode.frequency,
    modes: modes.slice(0, 3),
    vg_diagram: vgResult.vg_diagram,
    generated_at: new Date().toISOString(),
  });
});

router.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'aeroelastic',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
