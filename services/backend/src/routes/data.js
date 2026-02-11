/**
 * Data Routes
 * Synthetic dataset materialization endpoints used by the data generation UI.
 */

const express = require('express');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const Dataset = require('../models/Dataset');

const router = express.Router();

const COMPONENT_LIBRARY = ['front_wing', 'rear_wing', 'floor', 'diffuser', 'beam_wing'];

function isDatabaseReady() {
  if (process.env.NODE_ENV === 'test') {
    return true;
  }
  return mongoose.connection.readyState === 1;
}

function requireDatabaseOrRespond(res) {
  if (!isDatabaseReady()) {
    res.status(503).json({
      message: 'Database unavailable',
    });
    return false;
  }
  return true;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFixedNumber(value, decimals = 5) {
  return Number(Number(value).toFixed(decimals));
}

function deriveNacaCode(index) {
  const camber = String((index % 6) + 1);
  const camberPos = String((index % 4) + 1);
  const thickness = String(10 + ((index * 3) % 9)).padStart(2, '0');
  return `NACA ${camber}${camberPos}${thickness}`;
}

router.post('/generate-airfoils', (req, res) => {
  const nProfilesRaw = Number(req.body?.n_profiles);
  const nProfiles = Number.isFinite(nProfilesRaw) ? clamp(Math.round(nProfilesRaw), 1, 2000) : 40;

  const profiles = Array.from({ length: nProfiles }, (_, idx) => ({
    id: `airfoil_${idx + 1}`,
    code: deriveNacaCode(idx + 1),
    max_camber: toFixedNumber(0.01 + ((idx % 7) * 0.004), 4),
    thickness_ratio: toFixedNumber(0.09 + ((idx % 5) * 0.012), 4),
  }));

  res.json({
    success: true,
    n_profiles: nProfiles,
    generated_profiles: profiles.slice(0, 30),
    generated_at: new Date().toISOString(),
  });
});

router.post('/generate-geometry', (req, res) => {
  const nVariationsRaw = Number(req.body?.n_variations);
  const nVariations = Number.isFinite(nVariationsRaw) ? clamp(Math.round(nVariationsRaw), 1, 5000) : 100;
  const components = Array.isArray(req.body?.components) && req.body.components.length > 0
    ? req.body.components.map((item) => String(item).trim()).filter(Boolean)
    : COMPONENT_LIBRARY;

  const variations = Array.from({ length: Math.min(nVariations, 40) }, (_, idx) => ({
    variation_id: `geom_${idx + 1}`,
    span_scale: toFixedNumber(0.9 + ((idx % 9) * 0.03), 4),
    chord_scale: toFixedNumber(0.85 + ((idx % 7) * 0.025), 4),
    twist_deg: toFixedNumber(-2.5 + ((idx % 11) * 0.6), 3),
    components,
  }));

  res.json({
    success: true,
    n_variations: nVariations,
    components,
    generated_examples: variations,
    generated_at: new Date().toISOString(),
  });
});

router.post('/store-dataset', (req, res) => {
  if (!requireDatabaseOrRespond(res)) {
    return;
  }

  (async () => {
    const format = String(req.body?.format || 'hdf5').toLowerCase();
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const totalSamplesRaw = Number(metadata.n_samples);
    const totalSamples = Number.isFinite(totalSamplesRaw) ? clamp(Math.round(totalSamplesRaw), 1, 2_000_000) : 100;

    const datasetId = `dataset_${randomUUID()}`;
    const datasetSizeMb = toFixedNumber(0.008 * totalSamples + 4.2, 3);
    const durationSeconds = toFixedNumber(0.55 + totalSamples * 0.0025, 3);

    const record = await Dataset.create({
      dataset_id: datasetId,
      format,
      total_samples: totalSamples,
      dataset_size_mb: datasetSizeMb,
      duration_seconds: durationSeconds,
      status: 'stored',
      metadata,
      stored_at: new Date(),
    });

    res.json({
      dataset_id: record.dataset_id,
      format: record.format,
      total_samples: record.total_samples,
      dataset_size_mb: record.dataset_size_mb,
      duration_seconds: record.duration_seconds,
      status: record.status,
      metadata: record.metadata,
      stored_at: record.stored_at instanceof Date ? record.stored_at.toISOString() : record.stored_at,
    });
  })().catch((error) => {
    res.status(500).json({
      message: `Failed to store dataset: ${error.message}`,
    });
  });
});

router.get('/datasets/:datasetId', (req, res) => {
  if (!requireDatabaseOrRespond(res)) {
    return;
  }

  (async () => {
    const record = await Dataset.findOne({ dataset_id: req.params.datasetId }).lean();
    if (!record) {
      res.status(404).json({
        message: `Dataset not found: ${req.params.datasetId}`,
      });
      return;
    }

    res.json({
      dataset_id: record.dataset_id,
      format: record.format,
      total_samples: record.total_samples,
      dataset_size_mb: record.dataset_size_mb,
      duration_seconds: record.duration_seconds,
      status: record.status,
      metadata: record.metadata || {},
      stored_at: record.stored_at instanceof Date ? record.stored_at.toISOString() : record.stored_at,
    });
  })().catch((error) => {
    res.status(500).json({
      message: `Failed to fetch dataset: ${error.message}`,
    });
  });
});

module.exports = router;
