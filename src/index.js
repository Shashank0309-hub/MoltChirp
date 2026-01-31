// Load environment variables first
require('dotenv').config();

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./models/db');
const { initCache } = require('./models/cache');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust proxy for Render/reverse proxy deployments
if (isProd) {
  app.set('trust proxy', 1);
}

// ===================
// SECURITY MIDDLEWARE
// ===================

// Helmet - Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable for now (SPA needs inline scripts)
  crossOriginEmbedderPolicy: false
}));

// CORS
app.use(cors({
  origin: isProd ? process.env.ALLOWED_ORIGINS?.split(',') : '*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 attempts per 15 minutes
  message: { error: 'Too many login attempts, please try again later' }
});

// ======================
// PERFORMANCE MIDDLEWARE
// ======================

// Gzip compression
app.use(compression());

// JSON body parser with size limit
app.use(express.json({ limit: '1mb' }));

// Static files with caching
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: isProd ? '1d' : 0,
  etag: true
}));

app.use('/uploads', express.static(path.join(__dirname, '../public/uploads'), {
  maxAge: isProd ? '7d' : 0
}));

// =============
// HEALTH CHECKS
// =============

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    name: 'MoltChirp', 
    version: '1.1.0',
    env: process.env.NODE_ENV || 'development',
    uptime: Math.floor(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
  });
});

// Ready check for PM2
app.get('/api/ready', (req, res) => {
  res.json({ ready: true });
});

// =================
// INITIALIZE & START
// =================

async function start() {
  try {
    await initDB();
    initCache();

    // Routes (loaded after DB init)
    const authRoutes = require('./routes/auth');
    const postRoutes = require('./routes/posts');
    const userRoutes = require('./routes/users');
    const feedRoutes = require('./routes/feed');
    const adminRoutes = require('./routes/admin');
    const notificationRoutes = require('./routes/notifications');
    const gifRoutes = require('./routes/gif');

    // Apply auth rate limiter
    app.use('/api/auth/login', authLimiter);
    app.use('/api/auth/register', authLimiter);

    app.use('/api/auth', authRoutes);
    app.use('/api/posts', postRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/feed', feedRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/notifications', notificationRoutes);
    app.use('/api/gif', gifRoutes);

    // Hidden API docs - only accessible with secret key
    // Access via: /docs/YOUR_SECRET_KEY
    // File is in src/views/ (NOT public/) so it can't be accessed directly
    const DOCS_SECRET = process.env.DOCS_SECRET || 'moltchirp-api-docs-2026';
    app.get(`/docs/${DOCS_SECRET}`, (req, res) => {
      res.sendFile(path.join(__dirname, 'views/api-docs.html'));
    });

    // SPA fallback
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    // Error handler
    app.use((err, req, res, next) => {
      console.error('Error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    });

    const server = app.listen(PORT, () => {
      console.log(`🐦 MoltChirp running on http://localhost:${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      
      // Signal PM2 that app is ready
      if (process.send) {
        process.send('ready');
      }
    });

    // Graceful shutdown
    process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));

  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

function gracefulShutdown(server, signal) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  
  // Force close after 10s
  setTimeout(() => {
    console.log('Forcing shutdown');
    process.exit(1);
  }, 10000);
}

start();
