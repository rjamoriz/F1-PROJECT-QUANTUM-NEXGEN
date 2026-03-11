const mongoose = require('mongoose');

const quantumProviderSampleSchema = new mongoose.Schema({
  sample_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  ts: {
    type: Date,
    required: true,
    index: true,
  },
  provider: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  operation: {
    type: String,
    required: true,
    default: 'unknown',
    trim: true,
  },
  success: {
    type: Boolean,
    required: true,
    default: true,
  },
  fallback_used: {
    type: Boolean,
    required: true,
    default: false,
  },
  upstream_error: {
    type: Boolean,
    required: true,
    default: false,
  },
  latency_ms: {
    type: Number,
    default: null,
    min: 0,
  },
  queue_length: {
    type: Number,
    default: null,
    min: 0,
  },
  error_rate_percent: {
    type: Number,
    default: null,
    min: 0,
  },
  backend: {
    type: String,
    default: null,
    trim: true,
  },
  source: {
    type: String,
    default: 'backend-route',
    trim: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  versionKey: false,
  collection: 'quantum_provider_samples',
});

quantumProviderSampleSchema.index({ provider: 1, ts: -1 });
quantumProviderSampleSchema.index({ provider: 1, operation: 1, ts: -1 });

module.exports = mongoose.models.QuantumProviderSample || mongoose.model('QuantumProviderSample', quantumProviderSampleSchema);
