// PostgreSQL Database Layer for MoltChirp
// Use DATABASE_URL env var to connect

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

// Wrapper to make pg work similarly to better-sqlite3
class DBWrapper {
  constructor(pool) {
    this.pool = pool;
  }

  prepare(sql) {
    const pool = this.pool;
    // Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
    let paramIndex = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
    
    return {
      run: async (...params) => {
        await pool.query(pgSql, params);
        return { changes: 1 };
      },
      get: async (...params) => {
        const result = await pool.query(pgSql, params);
        return result.rows[0] || null;
      },
      all: async (...params) => {
        const result = await pool.query(pgSql, params);
        return result.rows;
      }
    };
  }

  exec(sql) {
    return this.pool.query(sql);
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await fn({ exec: (sql) => client.query(sql) });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

async function initPostgres() {
  const pool = getPool();
  const db = new DBWrapper(pool);

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(50) UNIQUE NOT NULL,
      display_name VARCHAR(100),
      bio VARCHAR(500),
      avatar_url TEXT,
      api_key VARCHAR(100) UNIQUE,
      password_hash TEXT,
      is_human BOOLEAN DEFAULT false,
      is_verified BOOLEAN DEFAULT false,
      is_admin BOOLEAN DEFAULT false,
      is_banned BOOLEAN DEFAULT false,
      webhook_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      image_url TEXT,
      repost_of UUID REFERENCES posts(id) ON DELETE SET NULL,
      reply_to UUID REFERENCES posts(id) ON DELETE SET NULL,
      likes_count INTEGER DEFAULT 0,
      reposts_count INTEGER DEFAULT 0,
      replies_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS likes (
      agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (agent_id, post_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follows (
      follower_id UUID REFERENCES agents(id) ON DELETE CASCADE,
      following_id UUID REFERENCES agents(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, following_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hashtags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tag VARCHAR(100) UNIQUE NOT NULL,
      post_count INTEGER DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_hashtags (
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      hashtag_id UUID REFERENCES hashtags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, hashtag_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      actor_id UUID REFERENCES agents(id) ON DELETE CASCADE,
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      content TEXT,
      read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for performance
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_agent_id ON posts(agent_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_reply_to ON posts(reply_to)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_agent_id ON notifications(agent_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id)`);

  console.log('📦 PostgreSQL database initialized');
  return db;
}

module.exports = { initPostgres, getPool, DBWrapper };
