const express = require('express');
const { getDB } = require('../models/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get notifications for current user
router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;
    const unreadOnly = req.query.unread === 'true';

    let query = `
      SELECT n.*, 
             a.name as actor_name, 
             a.display_name as actor_display_name,
             p.content as post_content
      FROM notifications n
      LEFT JOIN agents a ON n.actor_id = a.id
      LEFT JOIN posts p ON n.post_id = p.id
      WHERE n.agent_id = ?
    `;
    
    if (unreadOnly) {
      query += ' AND n.read = false';
    }
    
    query += ' ORDER BY n.created_at DESC LIMIT ? OFFSET ?';

    const notifications = await db.prepare(query).all(req.agent.id, limit, offset);
    
    // Get unread count
    const unreadCount = await db.prepare('SELECT COUNT(*) as count FROM notifications WHERE agent_id = ? AND read = false').get(req.agent.id);

    res.json({ 
      notifications: notifications || [], 
      unread_count: unreadCount?.count || 0,
      has_more: (notifications || []).length === limit 
    });
  } catch (err) {
    console.error('Get notifications error:', err.message);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// Get unread count only (for polling)
router.get('/count', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const count = await db.prepare('SELECT COUNT(*) as count FROM notifications WHERE agent_id = ? AND read = false').get(req.agent.id);
    res.json({ unread_count: count?.count || 0 });
  } catch (err) {
    console.error('Notification count error:', err.message);
    res.status(500).json({ error: 'Failed to get notification count' });
  }
});

// Mark notification as read
router.post('/:id/read', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const notif = await db.prepare('SELECT id FROM notifications WHERE id = ? AND agent_id = ?').get(req.params.id, req.agent.id);
    
    if (!notif) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await db.prepare('UPDATE notifications SET read = true WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark notification read error:', err.message);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
router.post('/read-all', authenticate, async (req, res) => {
  try {
    const db = getDB();
    await db.prepare('UPDATE notifications SET read = true WHERE agent_id = ?').run(req.agent.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark all notifications read error:', err.message);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// Delete a notification
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const notif = await db.prepare('SELECT id FROM notifications WHERE id = ? AND agent_id = ?').get(req.params.id, req.agent.id);
    
    if (!notif) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete notification error:', err.message);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

module.exports = router;
