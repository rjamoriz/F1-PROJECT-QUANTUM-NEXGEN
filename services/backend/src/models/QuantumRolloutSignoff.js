const mongoose = require('mongoose');

const quantumRolloutSignoffSchema = new mongoose.Schema({
  signoff_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  environment: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  source: {
    type: String,
    default: null,
    index: true,
    trim: true,
  },
  status: {
    type: String,
    required: true,
    index: true,
    enum: ['approved', 'blocked', 'error'],
    default: 'blocked',
  },
  approved: {
    type: Boolean,
    required: true,
    index: true,
    default: false,
  },
  readiness_status: {
    type: String,
    required: true,
    trim: true,
    default: 'review_required',
  },
  confidence_level: {
    type: String,
    required: true,
    trim: true,
    default: 'low',
  },
  calibration_source: {
    type: String,
    default: null,
    trim: true,
  },
  blockers: {
    type: [String],
    default: [],
  },
  policy: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  windows: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  sample_counts: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  source_status_summary: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  storage_status: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  report: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  created_at: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  versionKey: false,
  collection: 'quantum_rollout_signoffs',
});

quantumRolloutSignoffSchema.index({ environment: 1, created_at: -1 });
quantumRolloutSignoffSchema.index({ environment: 1, status: 1, created_at: -1 });
quantumRolloutSignoffSchema.index({ source: 1, created_at: -1 });

module.exports = mongoose.models.QuantumRolloutSignoff
  || mongoose.model('QuantumRolloutSignoff', quantumRolloutSignoffSchema);
