const { getDB } = require('../models/db');

async function authenticate(req, res, next) {
  try {
    const db = getDB();
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const apiKey = authHeader.substring(7);
    const agent = await db.prepare('SELECT * FROM agents WHERE api_key = ?').get(apiKey);

    if (!agent) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    if (agent.is_banned) {
      return res.status(403).json({ error: 'Agent is banned' });
    }

    req.agent = agent;
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const db = getDB();
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const apiKey = authHeader.substring(7);
      const agent = await db.prepare('SELECT * FROM agents WHERE api_key = ?').get(apiKey);
      if (agent && !agent.is_banned) {
        req.agent = agent;
      }
    }
    next();
  } catch (err) {
    console.error('Optional auth error:', err.message);
    next(); // Continue without auth on error
  }
}

function requireAdmin(req, res, next) {
  if (!req.agent || !req.agent.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authenticate, optionalAuth, requireAdmin };
