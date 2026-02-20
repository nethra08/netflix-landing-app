/**
 * Movie App - Express Server
 * Handles registration, login, session protection, and static file serving
 */

const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cors = require('cors');
require('dotenv').config();

const { initDatabase, getPool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: true, // Allow same-origin for session cookies
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
const isProduction = process.env.NODE_ENV === 'production' || isVercel;

// Initialize session store (will be set up after DB is ready)
let sessionStore = null;

// Function to initialize MySQL session store after database is ready
async function initializeSessionStore() {
  try {
    const { getDbConfig } = require('./db');
    const dbConfig = getDbConfig();
    const storeConfig = {
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      ssl: dbConfig.ssl,
      clearExpired: true,
      checkExpirationInterval: 900000, // 15 minutes
      expiration: 86400000, // 24 hours
    };
    sessionStore = new MySQLStore(storeConfig);
    console.log('✅ MySQL session store initialized');
  } catch (error) {
    console.warn('⚠️  Could not configure MySQL session store, using memory store:', error.message);
    sessionStore = null;
  }
}

// Initialize session store immediately if DB config is available
try {
  const { getDbConfig } = require('./db');
  getDbConfig(); // Test if config is available
  initializeSessionStore();
} catch (error) {
  // DB not configured yet, will use memory store initially
  console.log('ℹ️  Session store will use memory until database is configured');
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'movie-app-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'connect.sid', // Explicit session name
  store: sessionStore, // Use MySQL store if available, otherwise memory store
  cookie: {
    secure: isProduction, // HTTPS required in production/Vercel
    httpOnly: true,
    sameSite: 'lax', // Works for same-site (Vercel uses same domain)
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/', // Ensure cookie is available for all routes
  },
}));

/**
 * Session check middleware - protects routes
 */
function requireAuth(req, res, next) {
  // Debug: Log session info (remove in production)
  if (process.env.NODE_ENV !== 'production') {
    console.log('Session check:', {
      hasSession: !!req.session,
      userId: req.session?.userId,
      cookies: req.headers.cookie,
    });
  }
  
  if (req.session && req.session.userId) {
    next();
  } else {
    // For API requests, return JSON error instead of redirect
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    res.redirect('/login.html');
  }
}

// Get client directory path (works in both local and Vercel environments)
const clientDir = path.join(__dirname, '../client');
const clientPath = path.resolve(clientDir);

// Protect home page BEFORE static - only logged-in users can access
app.get('/home.html', requireAuth, (req, res) => {
  res.sendFile(path.join(clientPath, 'home.html'));
});

// Root - landing page if not logged in, home if logged in
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    res.redirect('/home.html');
  } else {
    res.sendFile(path.join(clientPath, 'landing.html'));
  }
});

// Serve static files from client folder (after protected routes)
app.use(express.static(clientPath));

// Database initialization promise (for Vercel serverless)
let dbInitPromise = null;

// Middleware to ensure database is initialized (for Vercel)
async function ensureDbInitialized() {
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
  if (isVercel) {
    if (!dbInitPromise) {
      dbInitPromise = initDatabase().then(async () => {
        // Initialize session store after DB is ready
        await initializeSessionStore();
        return true;
      }).catch(err => {
        console.error('Database initialization error:', err);
        dbInitPromise = null; // Reset on error so we can retry
        throw err;
      });
    }
    
    if (dbInitPromise) {
      try {
        await dbInitPromise;
      } catch (error) {
        throw new Error('Database connection failed');
      }
    }
  }
}

// ============ AUTH ROUTES ============

/**
 * POST /api/register - User registration
 */
app.post('/api/register', async (req, res) => {
  try {
    await ensureDbInitialized();
    const { userId, name, email, phone, password } = req.body;

    // Validate required fields
    if (!userId || !name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'userId, name, email, and password are required',
      });
    }

    // Validate userId format (alphanumeric)
    if (!/^[a-zA-Z0-9_]+$/.test(userId)) {
      return res.status(400).json({
        success: false,
        message: 'userId must contain only letters, numbers, and underscores',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address',
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    const pool = getPool();
    const [existingUser] = await pool.execute(
      'SELECT id FROM users WHERE userId = ?',
      [userId]
    );

    if (existingUser.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This userId is already taken. Please choose another.',
      });
    }

    // Hash password using bcrypt (never store plain text)
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    await pool.execute(
      'INSERT INTO users (userId, name, email, phone, password) VALUES (?, ?, ?, ?, ?)',
      [userId, name, email, phone || null, hashedPassword]
    );

    // Auto-login: create session so user goes straight to home
    req.session.userId = userId;
    req.session.userName = name;

    res.status(201).json({
      success: true,
      message: 'Account created! Taking you to the movies...',
      redirect: '/home.html',
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: error.message === 'Database connection failed' 
        ? 'Database connection failed. Please check configuration.'
        : 'Server error. Please try again later.',
    });
  }
});

/**
 * POST /api/login - User login
 */
app.post('/api/login', async (req, res) => {
  try {
    await ensureDbInitialized();
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        success: false,
        message: 'userId and password are required',
      });
    }

    const pool = getPool();
    const [users] = await pool.execute(
      'SELECT id, userId, name, password FROM users WHERE userId = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid userId or password',
      });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid userId or password',
      });
    }

    // Create session
    req.session.userId = user.userId;
    req.session.userName = user.name;

    res.json({
      success: true,
      message: 'Login successful!',
      redirect: '/home.html',
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: error.message === 'Database connection failed'
        ? 'Database connection failed. Please check configuration.'
        : 'Server error. Please try again later.',
    });
  }
});

/**
 * POST /api/logout - Destroy session
 */
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Logout failed' });
      }
      res.clearCookie('connect.sid');
      res.json({ success: true, redirect: '/login.html' });
    });
  });

/**
 * GET /api/session - Check if user is logged in
 */
app.get('/api/session', (req, res) => {
    if (req.session && req.session.userId) {
      res.json({
        loggedIn: true,
        userId: req.session.userId,
        userName: req.session.userName,
      });
    } else {
      res.json({ loggedIn: false });
    }
});

// Initialize database and start server
async function startServer() {
  try {
    await initDatabase();
    console.log('✅ Database initialized');
    
    // Initialize MySQL session store after DB is ready
    await initializeSessionStore();
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }

  // Start server (only if not running on Vercel)
  app.listen(PORT, () => {
    console.log(`🚀 Movie App running at http://localhost:${PORT}`);
    console.log(`   Login: http://localhost:${PORT}/login.html`);
    console.log(`   Register: http://localhost:${PORT}/register.html`);
  });
}

// Always export app for Vercel compatibility
// Vercel automatically sets VERCEL=1, but we check for both VERCEL and VERCEL_ENV
// Export app for Vercel (always export, Vercel will use it)
module.exports = app;

// Only start server if NOT on Vercel
if (!isVercel) {
  // Traditional hosting: Start server immediately
  startServer();
}
