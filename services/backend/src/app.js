/**
 * Quantum-Aero F1 Backend API Gateway
 * 
 * Main Express application that orchestrates:
 * - Physics Engine (VLM/Panel)
 * - ML Surrogate (GPU inference)
 * - Quantum Optimizer (QAOA/QUBO)
 * - GenAI Agents (Claude)
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./utils/logger');
const { connectDB, closeDB } = require('./config/database');
const { connectRedis, closeRedis } = require('./config/redis');

// Import routes
const physicsRoutes = require('./routes/physics');
const mlRoutes = require('./routes/ml');
const quantumRoutes = require('./routes/quantum');
const claudeRoutes = require('./routes/claude');
const simulationRoutes = require('./routes/simulation');
const multiFidelityRoutes = require('./routes/multiFidelity');
const systemRoutes = require('./routes/system');
const authRoutes = require('./routes/auth');
const aeroelasticRoutes = require('./routes/aeroelastic');
const transientRoutes = require('./routes/transient');
const dataRoutes = require('./routes/data');

// Initialize Express app
const app = express();

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseAllowedOrigins(rawOrigins) {
  if (!rawOrigins || typeof rawOrigins !== 'string') {
    return [];
  }

  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function buildCorsOptions() {
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  const credentials = process.env.CORS_ALLOW_CREDENTIALS === 'true';

  if (allowedOrigins.length === 0) {
    return {
      origin: true,
      credentials,
    };
  }

  return {
    credentials,
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  };
}

function buildRateLimitOptions() {
  return {
    windowMs: parsePositiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    max: parsePositiveInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 300),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
  };
}

// Middleware
app.use(helmet()); // Security headers
app.use(cors(buildCorsOptions())); // CORS
if (process.env.ENABLE_RATE_LIMIT !== 'false') {
  app.use(rateLimit(buildRateLimitOptions())); // Basic burst protection
}
app.use(compression()); // Response compression
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '10mb';
app.use(express.json({ limit: requestBodyLimit })); // JSON parser
app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'quantum-aero-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/physics', physicsRoutes);
app.use('/api/ml', mlRoutes);
app.use('/api/quantum', quantumRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/agents', claudeRoutes); // Compatibility alias for legacy Claude chat UI
app.use('/api/simulation', simulationRoutes);
app.use('/api/multi-fidelity', multiFidelityRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/aeroelastic', aeroelasticRoutes);
app.use('/api/transient', transientRoutes);
app.use('/api/data', dataRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Quantum-Aero F1 Backend API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      physics: '/api/physics',
      ml: '/api/ml',
      quantum: '/api/quantum',
      claude: '/api/claude',
      simulation: '/api/simulation',
      multi_fidelity: '/api/multi-fidelity',
      system: '/api/system',
      auth: '/api/auth',
      aeroelastic: '/api/aeroelastic',
      transient: '/api/transient',
      data: '/api/data'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Error:', err);

  const fallbackStatus = err?.message?.startsWith('CORS blocked') ? 403 : 500;
  const statusCode = err.status || fallbackStatus;

  res.status(statusCode).json({
    error: {
      message: err.message || 'Internal server error',
      status: statusCode,
      timestamp: new Date().toISOString()
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      status: 404,
      path: req.path
    }
  });
});

// Start server
const PORT = process.env.PORT || 3001;
let serverInstance = null;
let shutdownInProgress = false;

async function startServer(options = {}) {
  const port = options.port || PORT;
  const requireDatabase = options.requireDatabase ?? (process.env.REQUIRE_DATABASE !== 'false');
  const requireRedis = options.requireRedis ?? (process.env.REQUIRE_REDIS === 'true');

  try {
    try {
      await connectDB();
      logger.info('MongoDB connected');
    } catch (dbError) {
      if (requireDatabase) {
        throw dbError;
      }
      logger.warn(`MongoDB startup skipped: ${dbError.message}`);
    }

    try {
      await connectRedis();
      logger.info('Redis connected');
    } catch (redisError) {
      if (requireRedis) {
        throw redisError;
      }
      logger.warn(`Redis startup skipped: ${redisError.message}`);
    }

    await new Promise((resolve, reject) => {
      const nextServer = app.listen(port, () => {
        serverInstance = nextServer;
        logger.info(`Backend API running on port ${port}`);
        logger.info(`Health check: http://localhost:${port}/health`);
        logger.info(`API docs: http://localhost:${port}/`);
        resolve();
      });

      nextServer.on('error', reject);
    });

    return serverInstance;
  } catch (error) {
    logger.error('Failed to start server:', error);
    throw error;
  }
}

async function shutdown(signal) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  logger.info(`${signal} received, shutting down gracefully`);

  try {
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
      serverInstance = null;
    }

    await closeRedis();
    await closeDB();
  } catch (error) {
    logger.error('Error during shutdown:', error);
  } finally {
    process.exit(0);
  }
}

function registerSignalHandlers() {
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

if (require.main === module) {
  registerSignalHandlers();
  startServer().catch(() => {
    process.exit(1);
  });
}

module.exports = app;
module.exports.startServer = startServer;
