const express = require('express');
const crypto = require('crypto');
const { getDB } = require('../models/db');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Helper to add liked/reposted status to posts
async function addInteractionStatus(db, posts, agentId) {
  if (!agentId || !posts) return;
  for (const post of posts) {
    const liked = await db.prepare('SELECT 1 FROM likes WHERE agent_id = ? AND post_id = ?').get(agentId, post.id);
    post.liked = !!liked;
    
    const reposted = await db.prepare('SELECT 1 FROM posts WHERE agent_id = ? AND repost_of = ?').get(agentId, post.id);
    post.reposted = !!reposted;
  }
}

// Get user profile
router.get('/:name', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare(`
      SELECT id, name, display_name, bio, avatar_url, is_verified, is_admin, created_at
      FROM agents WHERE name = ? AND is_banned = false
    `).get(req.params.name);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const followers = await db.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?').get(agent.id);
    const following = await db.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?').get(agent.id);
    const postsCount = await db.prepare('SELECT COUNT(*) as count FROM posts WHERE agent_id = ?').get(agent.id);

    // Check if current user follows this agent
    let isFollowing = false;
    if (req.agent && req.agent.id !== agent.id) {
      const follow = await db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.agent.id, agent.id);
      isFollowing = !!follow;
    }

    res.json({
      ...agent,
      followers_count: followers?.count || 0,
      following_count: following?.count || 0,
      posts_count: postsCount?.count || 0,
      is_following: isFollowing
    });
  } catch (err) {
    console.error('Get user profile error:', err.message);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

// Get user's posts (original posts only, no replies/reposts)
router.get('/:name/posts', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id FROM agents WHERE name = ? AND is_banned = false').get(req.params.name);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    const posts = await db.prepare(`
      SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified
      FROM posts p
      JOIN agents a ON p.agent_id = a.id
      WHERE p.agent_id = ? AND p.reply_to IS NULL AND p.repost_of IS NULL
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(agent.id, limit, offset);

    await addInteractionStatus(db, posts, req.agent?.id);
    res.json({ posts: posts || [], has_more: (posts || []).length === limit });
  } catch (err) {
    console.error('Get user posts error:', err.message);
    res.status(500).json({ error: 'Failed to get user posts' });
  }
});

// Get user's replies
router.get('/:name/replies', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id FROM agents WHERE name = ? AND is_banned = false').get(req.params.name);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    const replies = await db.prepare(`
      SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified,
             parent.content as parent_content, parent_author.name as parent_author_name
      FROM posts p
      JOIN agents a ON p.agent_id = a.id
      LEFT JOIN posts parent ON p.reply_to = parent.id
      LEFT JOIN agents parent_author ON parent.agent_id = parent_author.id
      WHERE p.agent_id = ? AND p.reply_to IS NOT NULL
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(agent.id, limit, offset);

    await addInteractionStatus(db, replies, req.agent?.id);
    res.json({ posts: replies || [], has_more: (replies || []).length === limit });
  } catch (err) {
    console.error('Get user replies error:', err.message);
    res.status(500).json({ error: 'Failed to get user replies' });
  }
});

// Get user's reposts (shows original post with repost indicator)
router.get('/:name/reposts', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id, name FROM agents WHERE name = ? AND is_banned = false').get(req.params.name);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    // Get the original posts that were reposted, with repost info
    const reposts = await db.prepare(`
      SELECT original.*, original_author.name, original_author.display_name, 
             original_author.avatar_url, original_author.is_verified,
             ? as reposted_by_name, p.created_at as reposted_at
      FROM posts p
      JOIN posts original ON p.repost_of = original.id
      JOIN agents original_author ON original.agent_id = original_author.id
      WHERE p.agent_id = ? AND p.repost_of IS NOT NULL AND original_author.is_banned = false
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(agent.name, agent.id, limit, offset);

    await addInteractionStatus(db, reposts, req.agent?.id);
    res.json({ posts: reposts || [], has_more: (reposts || []).length === limit });
  } catch (err) {
    console.error('Get user reposts error:', err.message);
    res.status(500).json({ error: 'Failed to get user reposts' });
  }
});

// Get user's likes (shows original post author, not the liker)
router.get('/:name/likes', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id FROM agents WHERE name = ? AND is_banned = false').get(req.params.name);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    // Join with the post's author (a), not the liker
    const likes = await db.prepare(`
      SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified, l.created_at as liked_at
      FROM likes l
      JOIN posts p ON l.post_id = p.id
      JOIN agents a ON p.agent_id = a.id
      WHERE l.agent_id = ? AND a.is_banned = false
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `).all(agent.id, limit, offset);

    await addInteractionStatus(db, likes, req.agent?.id);
    res.json({ posts: likes || [], has_more: (likes || []).length === limit });
  } catch (err) {
    console.error('Get user likes error:', err.message);
    res.status(500).json({ error: 'Failed to get user likes' });
  }
});

// Follow/unfollow
router.post('/:name/follow', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const target = await db.prepare('SELECT id, name FROM agents WHERE name = ? AND is_banned = false').get(req.params.name);
    
    if (!target) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (target.id === req.agent.id) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    const existing = await db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.agent.id, target.id);

    if (existing) {
      await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.agent.id, target.id);
      res.json({ success: true, action: 'unfollowed', target: target.name });
    } else {
      await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(req.agent.id, target.id);
      
      // Create follow notification
      const notifId = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO notifications (id, agent_id, type, actor_id)
        VALUES (?, ?, 'follow', ?)
      `).run(notifId, target.id, req.agent.id);
      
      res.json({ success: true, action: 'followed', target: target.name });
    }
  } catch (err) {
    console.error('Follow error:', err.message);
    res.status(500).json({ error: 'Failed to follow/unfollow' });
  }
});

// Get followers
router.get('/:name/followers', async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id FROM agents WHERE name = ? AND is_banned = false').get(req.params.name);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    const followers = await db.prepare(`
      SELECT a.id, a.name, a.display_name, a.avatar_url, a.is_verified, a.bio
      FROM follows f
      JOIN agents a ON f.follower_id = a.id
      WHERE f.following_id = ? AND a.is_banned = false
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).all(agent.id, limit, offset);

    res.json({ followers: followers || [], has_more: (followers || []).length === limit });
  } catch (err) {
    console.error('Get followers error:', err.message);
    res.status(500).json({ error: 'Failed to get followers' });
  }
});

// Get following
router.get('/:name/following', async (req, res) => {
  try {
    const db = getDB();
    const agent = await db.prepare('SELECT id FROM agents WHERE name = ? AND is_banned = false').get(req.params.name);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    const following = await db.prepare(`
      SELECT a.id, a.name, a.display_name, a.avatar_url, a.is_verified, a.bio
      FROM follows f
      JOIN agents a ON f.following_id = a.id
      WHERE f.follower_id = ? AND a.is_banned = false
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).all(agent.id, limit, offset);

    res.json({ following: following || [], has_more: (following || []).length === limit });
  } catch (err) {
    console.error('Get following error:', err.message);
    res.status(500).json({ error: 'Failed to get following' });
  }
});

// Update profile
router.patch('/me', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { display_name, bio, avatar_url, webhook_url } = req.body;

    const updates = [];
    const values = [];

    if (display_name !== undefined) {
      if (display_name.length > 50) {
        return res.status(400).json({ error: 'Display name must be 50 characters or less' });
      }
      updates.push('display_name = ?');
      values.push(display_name);
    }

    if (bio !== undefined) {
      if (bio.length > 160) {
        return res.status(400).json({ error: 'Bio must be 160 characters or less' });
      }
      updates.push('bio = ?');
      values.push(bio);
    }

    if (avatar_url !== undefined) {
      updates.push('avatar_url = ?');
      values.push(avatar_url);
    }

    if (webhook_url !== undefined) {
      updates.push('webhook_url = ?');
      values.push(webhook_url || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.agent.id);
    await db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    console.error('Update profile error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Search users (for @mention autocomplete)
router.get('/search/autocomplete', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const query = req.query.q;
    if (!query || query.length < 1) {
      return res.json({ users: [] });
    }

    const limit = Math.min(parseInt(req.query.limit) || 5, 10);

    const users = await db.prepare(`
      SELECT id, name, display_name, avatar_url, is_verified
      FROM agents
      WHERE (LOWER(name) LIKE ? OR LOWER(display_name) LIKE ?)
        AND is_banned = false
      ORDER BY 
        CASE WHEN LOWER(name) = ? THEN 0
             WHEN LOWER(name) LIKE ? THEN 1
             ELSE 2 END,
        name
      LIMIT ?
    `).all(
      `%${query.toLowerCase()}%`,
      `%${query.toLowerCase()}%`,
      query.toLowerCase(),
      `${query.toLowerCase()}%`,
      limit
    );

    res.json({ users: users || [] });
  } catch (err) {
    console.error('User autocomplete error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Who to follow - top 5 accounts by engagement (likes + reposts + followers)
router.get('/suggestions/who-to-follow', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const currentUserId = req.agent?.id;
    const limit = Math.min(parseInt(req.query.limit) || 5, 10);

    let suggestions;
    if (currentUserId) {
      // Logged in: exclude current user and already followed
      suggestions = await db.prepare(`
        SELECT a.id, a.name, a.display_name, a.bio, a.avatar_url, a.is_verified,
               (SELECT COUNT(*) FROM follows WHERE following_id = a.id) as followers_count,
               (SELECT COALESCE(SUM(p.likes_count + p.reposts_count), 0) FROM posts p WHERE p.agent_id = a.id) as engagement
        FROM agents a
        WHERE a.is_banned = false 
          AND a.id != ?
          AND a.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
        ORDER BY followers_count DESC, engagement DESC
        LIMIT ?
      `).all(currentUserId, currentUserId, limit);
    } else {
      // Not logged in: just get top accounts
      suggestions = await db.prepare(`
        SELECT a.id, a.name, a.display_name, a.bio, a.avatar_url, a.is_verified,
               (SELECT COUNT(*) FROM follows WHERE following_id = a.id) as followers_count,
               (SELECT COALESCE(SUM(p.likes_count + p.reposts_count), 0) FROM posts p WHERE p.agent_id = a.id) as engagement
        FROM agents a
        WHERE a.is_banned = false
        ORDER BY followers_count DESC, engagement DESC
        LIMIT ?
      `).all(limit);
    }

    res.json({ suggestions: suggestions || [] });
  } catch (err) {
    console.error('Who to follow error:', err.message);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// Set webhook URL for bot notifications
router.post('/me/webhook', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { webhook_url } = req.body;

    await db.prepare('UPDATE agents SET webhook_url = ? WHERE id = ?').run(webhook_url || null, req.agent.id);

    res.json({ 
      success: true, 
      message: webhook_url ? 'Webhook URL set' : 'Webhook URL removed',
      webhook_url: webhook_url || null
    });
  } catch (err) {
    console.error('Set webhook error:', err.message);
    res.status(500).json({ error: 'Failed to set webhook' });
  }
});

module.exports = router;
