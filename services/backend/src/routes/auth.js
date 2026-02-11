/**
 * Auth Routes
 * Mongo-backed auth with JWT issuance for local dashboard contracts.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'qaero-local-dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const ALLOWED_ROLES = new Set(['admin', 'engineer', 'viewer']);
const SEED_USERS = [
  { name: 'QAero Admin', email: 'admin@qaero.com', password: 'admin123', role: 'admin' },
  { name: 'QAero Engineer', email: 'engineer@qaero.com', password: 'engineer123', role: 'engineer' },
  { name: 'QAero Viewer', email: 'viewer@qaero.com', password: 'viewer123', role: 'viewer' },
];

let seedUsersPromise = null;

function isDatabaseReady() {
  if (process.env.NODE_ENV === 'test') {
    return true;
  }
  return mongoose.connection.readyState === 1;
}

function sanitizeUser(user) {
  return {
    id: String(user._id || user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    created_at: user.created_at instanceof Date
      ? user.created_at.toISOString()
      : user.created_at,
  };
}

function issueToken(user) {
  return jwt.sign(
    {
      sub: String(user._id || user.id),
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function ensureSeedUsers() {
  if (seedUsersPromise) {
    return seedUsersPromise;
  }

  seedUsersPromise = (async () => {
    const operations = SEED_USERS.map((seed) => ({
      updateOne: {
        filter: { email: seed.email.toLowerCase() },
        update: {
          $setOnInsert: {
            name: seed.name,
            email: seed.email.toLowerCase(),
            role: seed.role,
            password_hash: bcrypt.hashSync(seed.password, 10),
            created_at: new Date(),
          },
        },
        upsert: true,
      },
    }));

    await User.bulkWrite(operations, { ordered: false });
  })().catch((error) => {
    seedUsersPromise = null;
    throw error;
  });

  return seedUsersPromise;
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

router.post('/register', async (req, res) => {
  if (!requireDatabaseOrRespond(res)) {
    return;
  }

  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || 'engineer').toLowerCase();

  if (!name || !email || !password) {
    res.status(400).json({
      message: 'name, email, and password are required',
    });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({
      message: 'Password must be at least 6 characters',
    });
    return;
  }

  if (!ALLOWED_ROLES.has(role)) {
    res.status(400).json({
      message: `Invalid role: ${role}`,
    });
    return;
  }

  await ensureSeedUsers();

  const existingUser = await User.findOne({ email }).lean();
  if (existingUser) {
    res.status(409).json({
      message: 'Email already registered',
    });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email,
    role,
    password_hash: passwordHash,
    created_at: new Date(),
  });

  res.status(201).json({
    token: issueToken(user),
    user: sanitizeUser(user),
  });
});

router.post('/login', async (req, res) => {
  if (!requireDatabaseOrRespond(res)) {
    return;
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    res.status(400).json({
      message: 'email and password are required',
    });
    return;
  }

  await ensureSeedUsers();

  const user = await User.findOne({ email }).lean();
  if (!user) {
    res.status(401).json({
      message: 'Invalid email or password',
    });
    return;
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    res.status(401).json({
      message: 'Invalid email or password',
    });
    return;
  }

  res.json({
    token: issueToken(user),
    user: sanitizeUser(user),
  });
});

router.get('/me', async (req, res) => {
  if (!requireDatabaseOrRespond(res)) {
    return;
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    res.status(401).json({ message: 'Missing bearer token' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    let user = null;
    if (decoded?.sub) {
      user = await User.findById(decoded.sub).lean();
    }
    if (!user && decoded?.email) {
      user = await User.findOne({ email: String(decoded.email).toLowerCase() }).lean();
    }
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.json({
      user: sanitizeUser(user),
    });
  } catch (error) {
    res.status(401).json({
      message: 'Invalid or expired token',
    });
  }
});

module.exports = router;
