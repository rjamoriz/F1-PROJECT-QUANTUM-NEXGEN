const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema({
  session_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  user_id: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  refresh_token_hash: {
    type: String,
    required: true,
    index: true,
  },
  refresh_expires_at: {
    type: Date,
    required: true,
  },
  revoked_at: {
    type: Date,
    default: null,
  },
  revocation_reason: {
    type: String,
    default: null,
  },
  created_at: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
  last_seen_at: {
    type: Date,
    default: Date.now,
  },
  metadata: {
    ip: { type: String, default: null },
    user_agent: { type: String, default: null },
  },
}, {
  versionKey: false,
  collection: 'auth_sessions',
});

authSessionSchema.index({ user_id: 1, revoked_at: 1 });
authSessionSchema.index({ refresh_expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.AuthSession || mongoose.model('AuthSession', authSessionSchema);
