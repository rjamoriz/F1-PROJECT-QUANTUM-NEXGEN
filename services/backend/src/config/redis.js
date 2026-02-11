/**
 * Redis Configuration
 * Handles Redis connection for caching and session management
 */

const redis = require('redis');
const logger = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let redisClient = null;
let redisUnavailableLogged = false;

function getActiveClient() {
  if (!redisClient || !redisClient.isOpen) {
    if (!redisUnavailableLogged) {
      logger.warn('Redis client unavailable; cache operations will be skipped');
      redisUnavailableLogged = true;
    }
    return null;
  }

  if (redisUnavailableLogged) {
    redisUnavailableLogged = false;
  }

  return redisClient;
}

/**
 * Connect to Redis with retry logic
 */
async function connectRedis() {
  try {
    redisClient = redis.createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('Redis max retries reached');
            return new Error('Max retries reached');
          }
          return retries * 1000; // Exponential backoff
        }
      }
    });

    // Error handling
    redisClient.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('✅ Redis connected successfully');
    });

    redisClient.on('reconnecting', () => {
      logger.warn('Redis reconnecting...');
    });

    redisClient.on('ready', () => {
      logger.info('📦 Redis ready');
    });

    await redisClient.connect();

  } catch (error) {
    logger.error('Redis connection failed:', error);
    throw error;
  }
}

/**
 * Get Redis client instance
 */
function getRedisClient() {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call connectRedis() first.');
  }
  return redisClient;
}

/**
 * Cache helper functions
 */
const cache = {
  /**
   * Get value from cache
   */
  async get(key) {
    const client = getActiveClient();
    if (!client) return null;

    try {
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  },

  /**
   * Set value in cache with optional TTL
   */
  async set(key, value, ttl = 3600) {
    const client = getActiveClient();
    if (!client) return false;

    try {
      await client.setEx(key, ttl, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
      return false;
    }
  },

  /**
   * Delete key from cache
   */
  async del(key) {
    const client = getActiveClient();
    if (!client) return false;

    try {
      await client.del(key);
      return true;
    } catch (error) {
      logger.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  },

  /**
   * Check if key exists
   */
  async exists(key) {
    const client = getActiveClient();
    if (!client) return false;

    try {
      return await client.exists(key);
    } catch (error) {
      logger.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  }
};

/**
 * Close Redis connection
 */
async function closeRedis() {
  try {
    if (redisClient) {
      await redisClient.quit();
      logger.info('Redis connection closed');
    }
  } catch (error) {
    logger.error('Error closing Redis connection:', error);
  }
}

module.exports = {
  connectRedis,
  getRedisClient,
  cache,
  closeRedis
};
