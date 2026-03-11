const mongoose = require('mongoose');

const auditEventSchema = new mongoose.Schema({
  event_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  category: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  action: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  outcome: {
    type: String,
    required: true,
    enum: ['success', 'denied', 'error', 'info'],
    default: 'info',
    index: true,
  },
  source: {
    type: String,
    default: 'http',
    index: true,
  },
  actor_user_id: {
    type: String,
    default: null,
    index: true,
  },
  actor_role: {
    type: String,
    default: null,
  },
  actor_email: {
    type: String,
    default: null,
  },
  target_type: {
    type: String,
    default: null,
    index: true,
  },
  target_id: {
    type: String,
    default: null,
    index: true,
  },
  car_ids: {
    type: [String],
    default: [],
  },
  reason: {
    type: String,
    default: null,
  },
  request_id: {
    type: String,
    default: null,
    index: true,
  },
  method: {
    type: String,
    default: null,
  },
  path: {
    type: String,
    default: null,
  },
  ip: {
    type: String,
    default: null,
  },
  user_agent: {
    type: String,
    default: null,
  },
  metadata: {
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
  collection: 'audit_events',
});

auditEventSchema.index({ category: 1, action: 1, created_at: -1 });
auditEventSchema.index({ outcome: 1, created_at: -1 });

module.exports = mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);
