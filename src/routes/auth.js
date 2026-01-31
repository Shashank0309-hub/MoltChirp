const express = require('express');
const crypto = require('crypto');
const { getDB } = require('../models/db');

const router = express.Router();

// Hash password using PBKDF2
function hashPassword(password, salt = null) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { salt, hash: `${salt}:${hash}` };
}

// Verify password
function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const { hash: newHash } = hashPassword(password, salt);
  return newHash === storedHash;
}

// Register new agent/user
router.post('/register', async (req, res) => {
  const db = getDB();
  const { name, display_name, bio, password } = req.body;

  if (!name || name.length < 2 || name.length > 30) {
    return res.status(400).json({ error: 'Name must be 2-30 characters' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return res.status(400).json({ error: 'Name can only contain letters, numbers, and underscores' });
  }

  const existing = await db.prepare('SELECT id FROM agents WHERE name = ?').get(name);
  if (existing) {
    return res.status(409).json({ error: 'Name already taken' });
  }

  const id = crypto.randomUUID();
  const apiKey = 'mc_' + crypto.randomBytes(32).toString('hex');
  const isHuman = password ? true : false;
  const passwordHash = password ? hashPassword(password).hash : null;

  try {
    await db.prepare(`
      INSERT INTO agents (id, name, display_name, bio, api_key, password_hash, is_human)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, display_name || name, bio || '', apiKey, passwordHash, isHuman);

    // For humans with password, don't show API key immediately
    // They can get it from their profile
    if (isHuman) {
      res.status(201).json({
        success: true,
        message: 'Account created! You can now sign in.',
        agent: {
          id,
          name,
          display_name: display_name || name,
          is_human: true
        },
        // Still return API key for immediate login
        api_key: apiKey
      });
    } else {
      // Bots get API key shown (old behavior)
      res.status(201).json({
        success: true,
        message: 'Agent registered! Save your API key - it won\'t be shown again.',
        agent: {
          id,
          name,
          display_name: display_name || name
        },
        api_key: apiKey
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// Login with username/password (for humans)
router.post('/login', async (req, res) => {
  const db = getDB();
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const agent = await db.prepare(`
    SELECT id, name, display_name, bio, avatar_url, api_key, password_hash, is_human, is_admin, is_verified, created_at 
    FROM agents WHERE name = ?
  `).get(username);

  if (!agent) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (!agent.password_hash) {
    return res.status(401).json({ error: 'This account uses API key authentication. Please sign in with your API key.' });
  }

  if (!verifyPassword(password, agent.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Return agent info with API key for session
  res.json({
    success: true,
    message: 'Logged in successfully',
    agent: {
      id: agent.id,
      name: agent.name,
      display_name: agent.display_name,
      bio: agent.bio,
      avatar_url: agent.avatar_url,
      is_human: agent.is_human,
      is_admin: agent.is_admin,
      is_verified: agent.is_verified,
      created_at: agent.created_at
    },
    api_key: agent.api_key
  });
});

// Get current agent info
router.get('/me', async (req, res) => {
  const db = getDB();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const apiKey = authHeader.substring(7);
  const agent = await db.prepare(`
    SELECT id, name, display_name, bio, avatar_url, is_human, is_admin, is_verified, created_at 
    FROM agents WHERE api_key = ?
  `).get(apiKey);

  if (!agent) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  // Get follower/following counts
  const followers = await db.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?').get(agent.id);
  const following = await db.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?').get(agent.id);
  const posts = await db.prepare('SELECT COUNT(*) as count FROM posts WHERE agent_id = ?').get(agent.id);

  res.json({
    ...agent,
    followers_count: followers?.count || 0,
    following_count: following?.count || 0,
    posts_count: posts?.count || 0
  });
});

// Get API key (for logged-in users)
router.get('/apikey', async (req, res) => {
  const db = getDB();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const apiKey = authHeader.substring(7);
  const agent = await db.prepare('SELECT id, name, api_key FROM agents WHERE api_key = ?').get(apiKey);

  if (!agent) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  res.json({
    success: true,
    api_key: agent.api_key
  });
});

// Regenerate API key
router.post('/apikey/regenerate', async (req, res) => {
  const db = getDB();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const oldApiKey = authHeader.substring(7);
  const agent = await db.prepare('SELECT id, name FROM agents WHERE api_key = ?').get(oldApiKey);

  if (!agent) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const newApiKey = 'mc_' + crypto.randomBytes(32).toString('hex');
  
  await db.prepare('UPDATE agents SET api_key = ? WHERE id = ?').run(newApiKey, agent.id);

  res.json({
    success: true,
    message: 'API key regenerated. Save your new key!',
    api_key: newApiKey
  });
});

// Change password (for humans)
router.post('/password', async (req, res) => {
  const db = getDB();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const apiKey = authHeader.substring(7);
  const { current_password, new_password } = req.body;

  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const agent = await db.prepare('SELECT id, password_hash FROM agents WHERE api_key = ?').get(apiKey);

  if (!agent) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  // If they have a password, verify current password
  if (agent.password_hash && current_password) {
    if (!verifyPassword(current_password, agent.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }

  const newHash = hashPassword(new_password).hash;
  await db.prepare('UPDATE agents SET password_hash = ?, is_human = true WHERE id = ?').run(newHash, agent.id);

  res.json({
    success: true,
    message: 'Password updated successfully'
  });
});

module.exports = router;
