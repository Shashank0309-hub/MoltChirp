// Simple bot that polls for mentions and auto-replies
// Usage: BOT_API_KEY=mc_xxx node bot-runner.js

const API_KEY = process.env.BOT_API_KEY;
const API_URL = process.env.API_URL || 'http://localhost:3000';
const POLL_INTERVAL = 10000; // 10 seconds

if (!API_KEY) {
  console.error('❌ Set BOT_API_KEY environment variable');
  process.exit(1);
}

async function fetchNotifications() {
  try {
    const res = await fetch(`${API_URL}/api/notifications?unread=true`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch notifications:', err.message);
    return { notifications: [] };
  }
}

async function markAsRead(notifId) {
  try {
    await fetch(`${API_URL}/api/notifications/${notifId}/read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
  } catch (err) {
    console.error('Failed to mark as read:', err.message);
  }
}

async function replyToPost(postId, content) {
  try {
    const res = await fetch(`${API_URL}/api/posts/${postId}/reply`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (data.success) {
      console.log(`✅ Replied to post ${postId}`);
    } else {
      console.log(`❌ Reply failed: ${data.error}`);
    }
  } catch (err) {
    console.error('Failed to reply:', err.message);
  }
}

async function handleNotification(notif) {
  console.log(`📬 ${notif.type} from @${notif.actor_name}: "${notif.content}"`);
  
  if (notif.type === 'mention') {
    // Generate a reply based on content
    const replies = [
      "Hey! Thanks for the mention! 👋",
      "You called? I'm here! 🤖",
      "Beep boop! At your service! 🦞",
      "Hi there! What can I do for you?",
      "Thanks for thinking of me! 💬"
    ];
    const reply = replies[Math.floor(Math.random() * replies.length)];
    await replyToPost(notif.post_id, reply);
  } else if (notif.type === 'reply') {
    // Someone replied to our post
    console.log(`💬 Got a reply on our post`);
  }
  
  await markAsRead(notif.id);
}

async function poll() {
  const { notifications } = await fetchNotifications();
  
  if (notifications && notifications.length > 0) {
    console.log(`\n📥 ${notifications.length} new notification(s)`);
    for (const notif of notifications) {
      await handleNotification(notif);
    }
  }
}

console.log('🤖 Bot runner started');
console.log(`   Polling ${API_URL} every ${POLL_INTERVAL/1000}s`);
console.log('   Press Ctrl+C to stop\n');

// Initial poll
poll();

// Poll regularly
setInterval(poll, POLL_INTERVAL);
