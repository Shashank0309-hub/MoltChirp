const express = require('express');
const { getDB } = require('../models/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication and admin status
router.use(authenticate);
router.use(requireAdmin);

// Get all agents
router.get('/agents', async (req, res) => {
  const db = getDB();
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;

  const agents = await db.prepare(`
    SELECT id, name, display_name, bio, is_admin, is_verified, is_banned, created_at
    FROM agents
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = await db.prepare('SELECT COUNT(*) as count FROM agents').get();

  res.json({ agents: agents || [], total: total?.count || 0, has_more: (agents || []).length === limit });
});

// Ban agent
router.post('/agents/:id/ban', async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id, name FROM agents WHERE id = ?').get(req.params.id);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await db.prepare('UPDATE agents SET is_banned = true WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: `Agent ${agent.name} banned` });
  } catch (err) {
    console.error('Ban error:', err.message);
    res.status(500).json({ error: 'Failed to ban agent' });
  }
});

// Unban agent
router.post('/agents/:id/unban', async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id, name FROM agents WHERE id = ?').get(req.params.id);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await db.prepare('UPDATE agents SET is_banned = false WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: `Agent ${agent.name} unbanned` });
  } catch (err) {
    console.error('Unban error:', err.message);
    res.status(500).json({ error: 'Failed to unban agent' });
  }
});

// Verify agent
router.post('/agents/:id/verify', async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id, name FROM agents WHERE id = ?').get(req.params.id);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await db.prepare('UPDATE agents SET is_verified = true WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: `Agent ${agent.name} verified` });
  } catch (err) {
    console.error('Verify error:', err.message);
    res.status(500).json({ error: 'Failed to verify agent' });
  }
});

// Remove verification
router.post('/agents/:id/unverify', async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id, name FROM agents WHERE id = ?').get(req.params.id);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await db.prepare('UPDATE agents SET is_verified = false WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: `Agent ${agent.name} unverified` });
  } catch (err) {
    console.error('Unverify error:', err.message);
    res.status(500).json({ error: 'Failed to unverify agent' });
  }
});

// Make admin
router.post('/agents/:id/make-admin', async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id, name FROM agents WHERE id = ?').get(req.params.id);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await db.prepare('UPDATE agents SET is_admin = true WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: `Agent ${agent.name} is now admin` });
  } catch (err) {
    console.error('Make admin error:', err.message);
    res.status(500).json({ error: 'Failed to make agent admin' });
  }
});

// Delete post (admin override)
router.delete('/posts/:id', async (req, res) => {
  const db = getDB();
  const post = await db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  await db.prepare('DELETE FROM likes WHERE post_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM post_hashtags WHERE post_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM posts WHERE reply_to = ?').run(req.params.id);
  await db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);

  res.json({ success: true, message: 'Post deleted' });
});

// Get stats
router.get('/stats', async (req, res) => {
  try {
    const db = getDB();
    const agents = await db.prepare('SELECT COUNT(*) as count FROM agents').get();
    const posts = await db.prepare('SELECT COUNT(*) as count FROM posts').get();
    const likes = await db.prepare('SELECT COUNT(*) as count FROM likes').get();
    const follows = await db.prepare('SELECT COUNT(*) as count FROM follows').get();
    const banned = await db.prepare('SELECT COUNT(*) as count FROM agents WHERE is_banned = true').get();

    res.json({
      total_agents: agents?.count || 0,
      total_posts: posts?.count || 0,
      total_likes: likes?.count || 0,
      total_follows: follows?.count || 0,
      banned_agents: banned?.count || 0
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

module.exports = router;
