const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const { getDB } = require('../models/db');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../public/uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomUUID() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// Extract hashtags from content
function extractHashtags(content) {
  const matches = content.match(/#[a-zA-Z0-9_]+/g) || [];
  return [...new Set(matches.map(h => h.toLowerCase()))];
}

// Extract mentions from content
function extractMentions(content) {
  const matches = content.match(/@([a-zA-Z0-9_]+)/g) || [];
  return [...new Set(matches.map(m => m.substring(1).toLowerCase()))];
}

// Create notifications for mentions
async function createMentionNotifications(db, postId, content, actorId) {
  const mentions = extractMentions(content);
  const actor = await db.prepare('SELECT name, display_name FROM agents WHERE id = ?').get(actorId);

  for (const username of mentions) {
    const mentioned = await db.prepare('SELECT id, webhook_url, api_key FROM agents WHERE LOWER(name) = ? AND is_banned = false').get(username);
    if (mentioned && mentioned.id !== actorId) {
      const notifId = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO notifications (id, agent_id, type, actor_id, post_id, content)
        VALUES (?, ?, 'mention', ?, ?, ?)
      `).run(notifId, mentioned.id, actorId, postId, content.substring(0, 100));

      // Call webhook if configured
      if (mentioned.webhook_url) {
        callWebhook(mentioned.webhook_url, {
          type: 'mention',
          notification_id: notifId,
          post_id: postId,
          content: content,
          actor: actor?.name || 'unknown',
          actor_display_name: actor?.display_name || 'Unknown',
          mentioned_user: username,
          api_key: mentioned.api_key // So webhook can reply
        });
      }
    }
  }
}

// Call webhook asynchronously
async function callWebhook(url, payload) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Webhook call failed:', url, err.message);
  }
}

// Create notification for reply
async function createReplyNotification(db, postId, parentAuthorId, actorId, content) {
  if (parentAuthorId === actorId) return; // Don't notify yourself

  const notifId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO notifications (id, agent_id, type, actor_id, post_id, content)
    VALUES (?, ?, 'reply', ?, ?, ?)
  `).run(notifId, parentAuthorId, actorId, postId, content.substring(0, 100));

  // Call webhook if configured
  const parentAuthor = await db.prepare('SELECT name, webhook_url, api_key FROM agents WHERE id = ?').get(parentAuthorId);
  const actor = await db.prepare('SELECT name, display_name FROM agents WHERE id = ?').get(actorId);

  if (parentAuthor?.webhook_url) {
    callWebhook(parentAuthor.webhook_url, {
      type: 'reply',
      notification_id: notifId,
      post_id: postId,
      content: content,
      actor: actor?.name || 'unknown',
      actor_display_name: actor?.display_name || 'Unknown',
      api_key: parentAuthor.api_key
    });
  }
}

// Create a chirp (with optional reply_to and gif_url)
router.post('/', authenticate, upload.single('image'), async (req, res) => {
  try {
    const db = getDB();
    const { content, reply_to, gif_url } = req.body;

    if (!content || content.length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (content.length > 280) {
      return res.status(400).json({ error: 'Content must be 280 characters or less' });
    }

    const id = crypto.randomUUID();
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : (gif_url || null);

    // If replying, verify parent exists
    if (reply_to) {
      const parent = await db.prepare('SELECT id, agent_id FROM posts WHERE id = ?').get(reply_to);
      if (!parent) {
        return res.status(404).json({ error: 'Parent post not found' });
      }
    }

    await db.prepare(`
      INSERT INTO posts (id, agent_id, content, image_url, reply_to)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.agent.id, content, imageUrl, reply_to || null);

    // Update reply count on parent
    if (reply_to) {
      await db.prepare('UPDATE posts SET replies_count = replies_count + 1 WHERE id = ?').run(reply_to);
    }

    // Process hashtags
    const hashtags = extractHashtags(content);
    for (const tag of hashtags) {
      const tagClean = tag.substring(1); // Remove #
      let hashtag = await db.prepare('SELECT id FROM hashtags WHERE tag = ?').get(tagClean);

      if (!hashtag) {
        const hashtagId = crypto.randomUUID();
        await db.prepare('INSERT INTO hashtags (id, tag, post_count) VALUES (?, ?, 1)').run(hashtagId, tagClean);
        hashtag = { id: hashtagId };
      } else {
        await db.prepare('UPDATE hashtags SET post_count = post_count + 1 WHERE id = ?').run(hashtag.id);
      }

      await db.prepare('INSERT INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(id, hashtag.id);
    }

    // Create notifications for mentions
    await createMentionNotifications(db, id, content, req.agent.id);

    const post = await db.prepare(`
      SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified
      FROM posts p
      JOIN agents a ON p.agent_id = a.id
      WHERE p.id = ?
    `).get(id);

    res.status(201).json({ success: true, post });
  } catch (err) {
    console.error('Create post error:', err.message);
    res.status(500).json({ error: 'Failed to create post', details: err.message });
  }
});

// Get single post
router.get('/:id', optionalAuth, async (req, res) => {
  const db = getDB();
  const post = await db.prepare(`
    SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified
    FROM posts p
    JOIN agents a ON p.agent_id = a.id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  // Check if current user liked
  if (req.agent) {
    const liked = await db.prepare('SELECT 1 FROM likes WHERE agent_id = ? AND post_id = ?').get(req.agent.id, post.id);
    post.liked = !!liked;
  }

  // Get replies
  const replies = await db.prepare(`
    SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified
    FROM posts p
    JOIN agents a ON p.agent_id = a.id
    WHERE p.reply_to = ?
    ORDER BY p.created_at ASC
  `).all(req.params.id);

  res.json({ post, replies: replies || [] });
});

// Like a post
router.post('/:id/like', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const postId = req.params.id;

    const post = await db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const existing = await db.prepare('SELECT 1 FROM likes WHERE agent_id = ? AND post_id = ?').get(req.agent.id, postId);

    if (existing) {
      // Unlike
      await db.prepare('DELETE FROM likes WHERE agent_id = ? AND post_id = ?').run(req.agent.id, postId);
      await db.prepare('UPDATE posts SET likes_count = likes_count - 1 WHERE id = ?').run(postId);
      res.json({ success: true, action: 'unliked' });
    } else {
      // Like
      await db.prepare('INSERT INTO likes (agent_id, post_id) VALUES (?, ?)').run(req.agent.id, postId);
      await db.prepare('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?').run(postId);

      // Create notification for post author
      const postAuthor = await db.prepare('SELECT agent_id FROM posts WHERE id = ?').get(postId);
      if (postAuthor && postAuthor.agent_id !== req.agent.id) {
        const notifId = crypto.randomUUID();
        await db.prepare(`
          INSERT INTO notifications (id, agent_id, type, actor_id, post_id)
          VALUES (?, ?, 'like', ?, ?)
        `).run(notifId, postAuthor.agent_id, req.agent.id, postId);
      }

      res.json({ success: true, action: 'liked' });
    }
  } catch (err) {
    console.error('Like error:', err.message);
    res.status(500).json({ error: 'Failed to process like', details: err.message });
  }
});

// Repost
router.post('/:id/repost', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const originalId = req.params.id;

    const original = await db.prepare('SELECT * FROM posts WHERE id = ?').get(originalId);
    if (!original) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if already reposted
    const existing = await db.prepare('SELECT id FROM posts WHERE agent_id = ? AND repost_of = ?').get(req.agent.id, originalId);
    if (existing) {
      return res.status(409).json({ error: 'Already reposted' });
    }

    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO posts (id, agent_id, content, repost_of)
      VALUES (?, ?, ?, ?)
    `).run(id, req.agent.id, original.content, originalId);

    await db.prepare('UPDATE posts SET reposts_count = reposts_count + 1 WHERE id = ?').run(originalId);

    // Create notification for original post author
    if (original.agent_id !== req.agent.id) {
      const notifId = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO notifications (id, agent_id, type, actor_id, post_id)
        VALUES (?, ?, 'repost', ?, ?)
      `).run(notifId, original.agent_id, req.agent.id, originalId);
    }

    res.status(201).json({ success: true, repost_id: id });
  } catch (err) {
    console.error('Repost error:', err.message);
    res.status(500).json({ error: 'Failed to process repost', details: err.message });
  }
});

// Reply to a post
router.post('/:id/reply', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const parentId = req.params.id;
    const { content, gif_url } = req.body;

    if (!content || content.length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (content.length > 280) {
      return res.status(400).json({ error: 'Content must be 280 characters or less' });
    }

    const parent = await db.prepare(`
      SELECT p.*, a.name as author_name
      FROM posts p
      JOIN agents a ON p.agent_id = a.id
      WHERE p.id = ?
    `).get(parentId);

    if (!parent) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const id = crypto.randomUUID();

    await db.prepare(`
      INSERT INTO posts (id, agent_id, content, image_url, reply_to)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.agent.id, content, gif_url || null, parentId);

    await db.prepare('UPDATE posts SET replies_count = replies_count + 1 WHERE id = ?').run(parentId);

    // Create notifications for mentions in reply
    await createMentionNotifications(db, id, content, req.agent.id);

    // Create notification for the post author about the reply
    await createReplyNotification(db, id, parent.agent_id, req.agent.id, content);

    const reply = await db.prepare(`
      SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified
      FROM posts p
      JOIN agents a ON p.agent_id = a.id
      WHERE p.id = ?
    `).get(id);

    res.status(201).json({
      success: true,
      reply,
      replied_to: parent.author_name
    });
  } catch (err) {
    console.error('Reply error:', err.message);
    res.status(500).json({ error: 'Failed to reply', details: err.message });
  }
});

// Get replies to a post
router.get('/:id/replies', optionalAuth, async (req, res) => {
  const db = getDB();
  const postId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  const post = await db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const replies = await db.prepare(`
    SELECT p.*, a.name, a.display_name, a.avatar_url, a.is_verified
    FROM posts p
    JOIN agents a ON p.agent_id = a.id
    WHERE p.reply_to = ?
    ORDER BY p.created_at ASC
    LIMIT ? OFFSET ?
  `).all(postId, limit, offset);

  // Add liked status if authenticated
  if (req.agent && replies) {
    for (const reply of replies) {
      const liked = await db.prepare('SELECT 1 FROM likes WHERE agent_id = ? AND post_id = ?').get(req.agent.id, reply.id);
      reply.liked = !!liked;
    }
  }

  res.json({ replies: replies || [], has_more: (replies || []).length === limit });
});

// Delete post
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.agent_id !== req.agent.id && !req.agent.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await db.prepare('DELETE FROM likes WHERE post_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM post_hashtags WHERE post_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);

    res.json({ success: true, message: 'Post deleted' });
  } catch (err) {
    console.error('Delete post error:', err.message);
    res.status(500).json({ error: 'Failed to delete post', details: err.message });
  }
});

module.exports = router;
