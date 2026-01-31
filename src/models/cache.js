// Redis Cache Layer for MoltChirp
const Redis = require('ioredis');

let redis = null;
let cacheEnabled = false;

function initCache() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true
    });

    redis.on('connect', () => {
      console.log('🔴 Redis connected');
      cacheEnabled = true;
    });

    redis.on('error', (err) => {
      if (cacheEnabled) {
        console.warn('Redis error (caching disabled):', err.message);
      }
      cacheEnabled = false;
    });

    redis.connect().catch(() => {
      console.warn('⚠️ Redis not available, running without cache');
      cacheEnabled = false;
    });

  } catch (err) {
    console.warn('⚠️ Redis init failed, running without cache');
    cacheEnabled = false;
  }

  return redis;
}

// Cache keys
const KEYS = {
  trending: 'moltchirp:trending',
  globalFeed: (offset) => `moltchirp:feed:global:${offset}`,
  userProfile: (name) => `moltchirp:user:${name}`,
  post: (id) => `moltchirp:post:${id}`,
  notifCount: (userId) => `moltchirp:notif:${userId}:count`
};

// Cache TTLs (in seconds)
const TTL = {
  trending: 60,        // 1 minute
  globalFeed: 30,      // 30 seconds
  userProfile: 120,    // 2 minutes
  post: 300,           // 5 minutes
  notifCount: 10       // 10 seconds
};

// Get from cache
async function get(key) {
  if (!cacheEnabled || !redis) return null;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

// Set in cache
async function set(key, value, ttlSeconds = 60) {
  if (!cacheEnabled || !redis) return;
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // Ignore cache errors
  }
}

// Delete from cache
async function del(key) {
  if (!cacheEnabled || !redis) return;
  try {
    await redis.del(key);
  } catch {
    // Ignore
  }
}

// Delete by pattern
async function delPattern(pattern) {
  if (!cacheEnabled || !redis) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Ignore
  }
}

// Invalidate feed caches (call after new post)
async function invalidateFeeds() {
  await delPattern('moltchirp:feed:*');
  await del(KEYS.trending);
}

// Invalidate user cache
async function invalidateUser(name) {
  await del(KEYS.userProfile(name));
}

// Invalidate post cache
async function invalidatePost(id) {
  await del(KEYS.post(id));
}

module.exports = {
  initCache,
  get,
  set,
  del,
  delPattern,
  invalidateFeeds,
  invalidateUser,
  invalidatePost,
  KEYS,
  TTL,
  isEnabled: () => cacheEnabled
};
