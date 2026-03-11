const mongoose = require('mongoose');

const telemetryPointSchema = new mongoose.Schema({
  telemetry_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  car_id: {
    type: String,
    required: true,
    index: true,
  },
  source: {
    type: String,
    required: true,
    default: 'api',
  },
  timestamp: {
    type: Date,
    required: true,
    index: true,
  },
  lap: {
    type: Number,
    required: true,
    default: 0,
  },
  sector: {
    type: Number,
    required: true,
    min: 1,
    max: 3,
    default: 1,
  },
  speed_kph: {
    type: Number,
    required: true,
    min: 0,
  },
  yaw_deg: {
    type: Number,
    required: true,
    default: 0,
  },
  downforce_n: {
    type: Number,
    required: true,
    min: 0,
  },
  drag_n: {
    type: Number,
    required: true,
    min: 0,
  },
  battery_soc: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  ers_deploy_kw: {
    type: Number,
    required: true,
    min: 0,
  },
  drs_open: {
    type: Boolean,
    required: true,
    default: false,
  },
  track_temp_c: {
    type: Number,
    required: true,
    default: 30,
  },
  anomalies: {
    type: [String],
    default: [],
  },
}, {
  versionKey: false,
  collection: 'telemetry_points',
});

telemetryPointSchema.index({ car_id: 1, timestamp: -1 });

module.exports = mongoose.models.TelemetryPoint || mongoose.model('TelemetryPoint', telemetryPointSchema);
