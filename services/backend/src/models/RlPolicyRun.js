const mongoose = require('mongoose');

const RlPolicyRunSchema = new mongoose.Schema(
  {
    run_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    track_id: {
      type: String,
      default: 'global',
      index: true,
    },
    policy_name: {
      type: String,
      default: 'ppo-active-control-v1',
    },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'completed',
      index: true,
    },
    source: {
      type: String,
      default: 'synthetic-trainer',
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    metrics: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    action_profile: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    deployment: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    created_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
    started_at: {
      type: Date,
      default: Date.now,
    },
    completed_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
    duration_ms: {
      type: Number,
      default: 0,
    },
  },
  {
    versionKey: false,
    collection: 'rl_policy_runs',
  }
);

module.exports = mongoose.models.RlPolicyRun || mongoose.model('RlPolicyRun', RlPolicyRunSchema);
