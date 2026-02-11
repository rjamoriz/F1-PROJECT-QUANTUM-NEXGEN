const mongoose = require('mongoose');

const datasetSchema = new mongoose.Schema({
  dataset_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  format: {
    type: String,
    required: true,
    default: 'hdf5',
  },
  total_samples: {
    type: Number,
    required: true,
    min: 1,
  },
  dataset_size_mb: {
    type: Number,
    required: true,
    min: 0,
  },
  duration_seconds: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    required: true,
    default: 'stored',
  },
  metadata: {
    type: Object,
    default: {},
  },
  stored_at: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  versionKey: false,
  collection: 'datasets',
});

module.exports = mongoose.models.Dataset || mongoose.model('Dataset', datasetSchema);
