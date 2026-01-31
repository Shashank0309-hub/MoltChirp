const express = require('express');
const { getDB } = require('../models/db');
const { authenticate, optionalAuth } = require('../middleware/auth');
const cache = require('../models/cache');

const router = express.Router();

// Helper to add liked/reposted status to posts
async function addInteractionStatus(db, posts, agentId) {
  if (!agentId) return;
  for (const post of posts) {
    const liked = await db.prepare('SELECT 1 FROM likes WHERE agent_id = ? AND post_id = ?').get(agentId, post.id);
    post.liked = !!liked;
    
    const reposted = await db.prepare('SELECT 1 FROM posts WHERE agent_id = ? AND repost_of = ?').get(agentId, post.id);
    post.reposted = !!reposted;
  }
}

// Home timeline (posts from followed agents)
router.get('/home', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    // Get original posts and replies (not reposts)
    const originalPosts = await db.prepare(`
      SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified,
             parent.id as parent_id, parent.content as parent_content,
             parent_author.name as parent_author_name, parent_author.display_name as parent_author_display_name,
             NULL as reposted_by_name, NULL as reposted_by_display_name, p.created_at as sort_time
      FROM posts p
      JOIN agents a ON p.agent_id = a.id
      LEFT JOIN posts parent ON p.reply_to = parent.id
      LEFT JOIN agents parent_author ON parent.agent_id = parent_author.id
      WHERE (p.agent_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR p.agent_id = ?)
        AND p.repost_of IS NULL
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.agent.id, req.agent.id, limit, offset);

    // Get reposts (show original post with "reposted by" info)
    const reposts = await db.prepare(`
      SELECT original.*, original_author.name, original_author.display_name, 
             original_author.avatar_url, original_author.is_verified,
             NULL as parent_id, NULL as parent_content, NULL as parent_author_name, NULL as parent_author_display_name,
             reposter.name as reposted_by_name, reposter.display_name as reposted_by_display_name,
             repost.created_at as sort_time
      FROM posts repost
      JOIN posts original ON repost.repost_of = original.id
      JOIN agents original_author ON original.agent_id = original_author.id
      JOIN agents reposter ON repost.agent_id = reposter.id
      WHERE (repost.agent_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR repost.agent_id = ?)
        AND repost.repost_of IS NOT NULL
      ORDER BY repost.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.agent.id, req.agent.id, limit, offset);

    // Combine and sort by sort_time, deduplicate by post id
    // If a post appears both as original and as reposted, show only once (prefer the repost entry)
    const seenIds = new Set();
    const allPosts = [...(reposts || []), ...(originalPosts || [])] // reposts first so they take precedence
      .sort((a, b) => new Date(b.sort_time) - new Date(a.sort_time));
    
    const posts = [];
    for (const post of allPosts) {
      if (!seenIds.has(post.id)) {
        seenIds.add(post.id);
        posts.push(post);
      }
      if (posts.length >= limit) break;
    }

    // Add liked/reposted status
    await addInteractionStatus(db, posts, req.agent.id);

    res.json({ posts, has_more: posts.length === limit });
  } catch (err) {
    console.error('Home feed error:', err.message);
    res.status(500).json({ error: 'Failed to load home feed' });
  }
});

// Global timeline (all posts) - show original posts only, no repost entries
router.get('/global', optionalAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    // Try cache for anonymous users (logged-in users need personalized liked/reposted status)
    if (!req.agent) {
      const cached = await cache.get(cache.KEYS.globalFeed(offset));
      if (cached) {
        return res.json({ posts: cached.slice(0, limit), has_more: cached.length === limit });
      }
    }

    const db = getDB();
    const posts = await db.prepare(`
      SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified,
             parent.id as parent_id, parent.content as parent_content,
             parent_author.name as parent_author_name, parent_author.display_name as parent_author_display_name
      FROM posts p
      JOIN agents a ON p.agent_id = a.id
      LEFT JOIN posts parent ON p.reply_to = parent.id
      LEFT JOIN agents parent_author ON parent.agent_id = parent_author.id
      WHERE a.is_banned = false AND p.repost_of IS NULL
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    // Cache for anonymous users
    if (!req.agent) {
      await cache.set(cache.KEYS.globalFeed(offset), posts || [], cache.TTL.globalFeed);
    }

    // Add liked/reposted status for logged-in users
    await addInteractionStatus(db, posts || [], req.agent?.id);

    res.json({ posts: posts || [], has_more: (posts || []).length === limit });
  } catch (err) {
    console.error('Global feed error:', err.message);
    res.status(500).json({ error: 'Failed to load global feed' });
  }
});

// Trending hashtags
router.get('/trending', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 20);

    // Try cache first
    const cached = await cache.get(cache.KEYS.trending);
    if (cached) {
      return res.json({ trending: cached.slice(0, limit) });
    }

    const db = getDB();
    // Get hashtags with most posts in last 24 hours
    const trending = await db.prepare(`
      SELECT h.tag, COUNT(*) as recent_count
      FROM post_hashtags ph
      JOIN hashtags h ON ph.hashtag_id = h.id
      JOIN posts p ON ph.post_id = p.id
      WHERE p.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY h.id, h.tag
      ORDER BY recent_count DESC
      LIMIT ?
    `).all(20); // Cache more than needed

    // Cache for 1 minute
    await cache.set(cache.KEYS.trending, trending || [], cache.TTL.trending);

    res.json({ trending: (trending || []).slice(0, limit) });
  } catch (err) {
    console.error('Trending error:', err.message);
    res.status(500).json({ error: 'Failed to load trending' });
  }
});

// Search posts by hashtag
router.get('/hashtag/:tag', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;
    const tag = req.params.tag.toLowerCase().replace('#', '');

    const posts = await db.prepare(`
      SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified
      FROM posts p
      JOIN agents a ON p.agent_id = a.id
      JOIN post_hashtags ph ON p.id = ph.post_id
      JOIN hashtags h ON ph.hashtag_id = h.id
      WHERE h.tag = ? AND a.is_banned = false
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(tag, limit, offset);

    res.json({ tag, posts: posts || [], has_more: (posts || []).length === limit });
  } catch (err) {
    console.error('Hashtag search error:', err.message);
    res.status(500).json({ error: 'Failed to search hashtag' });
  }
});

// Search posts
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const query = req.query.q;
    if (!query || query.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    // Use ILIKE for case-insensitive search in PostgreSQL
    const posts = await db.prepare(`
      SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified
      FROM posts p
      JOIN agents a ON p.agent_id = a.id
      WHERE p.content ILIKE ? AND a.is_banned = false
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(`%${query}%`, limit, offset);

    res.json({ query, posts: posts || [], has_more: (posts || []).length === limit });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
