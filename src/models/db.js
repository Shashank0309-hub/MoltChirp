// Database Layer - Supports SQLite (dev) and PostgreSQL (prod)
// Set DATABASE_URL env var to use PostgreSQL

const path = require('path');
const fs = require('fs');

let db = null;
let isPostgres = false;

// Check if using PostgreSQL
function usePostgres() {
  return !!process.env.DATABASE_URL;
}

// SQLite initialization using sql.js
async function initSQLite() {
  const initSqlJs = require('sql.js');
  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '../../moltchirp.db');
  
  const SQL = await initSqlJs();
  
  // Load existing database or create new
  let sqlDb;
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    const data = new Uint8Array(fileBuffer);
    sqlDb = new SQL.Database(data);
    console.log(`📂 Loaded existing database from ${dbPath}`);
  } else {
    sqlDb = new SQL.Database();
    console.log(`📂 Created new database at ${dbPath}`);
  }
  
  // Wrapper to match better-sqlite3 API
  const wrapper = {
    prepare: (sql) => ({
      run: (...params) => {
        sqlDb.run(sql, params);
        save();
        return { changes: sqlDb.getRowsModified() };
      },
      get: (...params) => {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return null;
      },
      all: (...params) => {
        const results = [];
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      }
    }),
    exec: (sql) => {
      sqlDb.run(sql);
      save();
    },
    pragma: () => {} // No-op for sql.js
  };
  
  // Save function
  function save() {
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
  
  // Create tables
  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT,
      bio TEXT,
      avatar_url TEXT,
      api_key TEXT UNIQUE,
      password_hash TEXT,
      is_human INTEGER DEFAULT 0,
      is_verified INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      webhook_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      repost_of TEXT,
      reply_to TEXT,
      likes_count INTEGER DEFAULT 0,
      reposts_count INTEGER DEFAULT 0,
      replies_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS likes (
      agent_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (agent_id, post_id)
    )
  `);

  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, following_id)
    )
  `);

  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS hashtags (
      id TEXT PRIMARY KEY,
      tag TEXT UNIQUE NOT NULL,
      post_count INTEGER DEFAULT 0
    )
  `);

  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS post_hashtags (
      post_id TEXT NOT NULL,
      hashtag_id TEXT NOT NULL,
      PRIMARY KEY (post_id, hashtag_id)
    )
  `);

  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      actor_id TEXT,
      post_id TEXT,
      content TEXT,
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('📦 Database initialized');
  return wrapper;
}

// Initialize database
async function initDB() {
  if (usePostgres()) {
    isPostgres = true;
    const { initPostgres } = require('./db-postgres');
    db = await initPostgres();
  } else {
    db = await initSQLite();
  }
  return db;
}

// Get database instance
function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return db;
}

// Check if using PostgreSQL
function isUsingPostgres() {
  return isPostgres;
}

module.exports = { initDB, getDB, isUsingPostgres };
