const express = require('express')
const cookieParser = require('cookie-parser')
const { v4: uuidv4 } = require('uuid')
const bcrypt = require('bcryptjs')
const nodemailer = require('nodemailer')
const rateLimit = require('express-rate-limit')
const csrf = require('csurf')

const app = express()
const PORT = process.env.PORT
const API_BASE = process.env.NODE_ENV == "production" ? process.env.API_BASE : `http://localhost:${PORT}`

// Email configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

async function sendVerificationEmail(email, token) {
  const verificationUrl = `${API_BASE}/verify-email.html?token=${token}`;
  
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Verify your email for Trippino',
    html: `
      <h1>Welcome to Trippino!</h1>
      <p>Please click the link below to verify your email address:</p>
      <p><a href="${verificationUrl}">Verify my email</a></p>
      <p>If you didn't create an account, you can ignore this email.</p>
    `
  });
}

const path = require('path')
const sqlite3 = require('sqlite3')
const DATABASE_URL = process.env["DATABASE_URL"] || path.join(__dirname, 'data.sqlite')
console.log('SQLite DB path:', DATABASE_URL)

// open DB
const db = new sqlite3.Database(DATABASE_URL)

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { if (err) return reject(err); resolve(this) })
  })
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) return reject(err); resolve(row) })
  })
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) return reject(err); resolve(rows) })
  })
}

// initialize schema
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    email TEXT UNIQUE, 
    password TEXT,
    verified BOOLEAN DEFAULT 0,
    verification_token TEXT,
    verification_expires INTEGER
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, user_id INTEGER, createdAt INTEGER)`)
  db.run(`CREATE TABLE IF NOT EXISTS states (user_id INTEGER PRIMARY KEY, state TEXT)`)
  // seed demo users with hashed passwords
  try {
    const marcHash = bcrypt.hashSync('marc', 10)
    db.run(`INSERT OR IGNORE INTO users(email,password,verified) VALUES(?,?,1)`, ['marc@demo.com', marcHash])
  } catch (e) {
    console.error('failed seeding users', e)
  }
})

// cookie name
const COOKIE_NAME = 'trippino_sid'

app.use(express.json())
app.use(cookieParser())

// --- CSRF Protection ---
const csrfProtection = csrf({ 
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  }
})

// --- Rate Limiters ---

// Strict rate limiter for authentication endpoints (login, register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  // Use IP address as identifier
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress
  }
})

// Moderate rate limiter for registration (prevent spam account creation)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: { error: 'Too many registration attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress
  }
})

// Rate limiter for password change (prevent brute force on current password)
const passwordChangeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 password change attempts per hour
  message: { error: 'Too many password change attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use session ID if available, otherwise IP
    return req.cookies[COOKIE_NAME] || req.ip || req.connection.remoteAddress
  }
})

// General API rate limiter (prevent abuse of all endpoints)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress
  },
  // Skip rate limiting for health check
  skip: (req) => req.path === '/api/health'
})

// Apply general API rate limiter to all /api routes
app.use('/api', apiLimiter)

// --- API Health Check ---
app.get('/api/health', (req, res) => res.json({ ok: true }))

// Get CSRF token endpoint
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() })
})

// Verify email endpoint
app.get('/api/verify-email', async (req, res) => {
  try {
    const { token } = req.query
    if (!token) return res.status(400).json({ error: 'verification token required' })

    const user = await get(
      `SELECT id FROM users WHERE verification_token = ? AND verification_expires > ? AND verified = 0`,
      [token, Date.now()]
    )

    if (!user) return res.status(400).json({ error: 'invalid or expired verification token' })

    await run(
      `UPDATE users SET verified = 1, verification_token = NULL WHERE id = ?`,
      [user.id]
    )

    return res.json({ ok: true, message: 'email verified successfully' })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: 'server error' })
  }
})

// --- Serve frontend files ---
app.use(express.static(path.join(__dirname, "public")));

// --- Dynamic config.js ---
app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.send(`window.APP_CONFIG = { API_BASE: "${API_BASE}" };`);
});

async function createSessionForUserId(userId) {
  const sid = uuidv4()
  const createdAt = Date.now()
  await run(`INSERT INTO sessions(sid, user_id, createdAt) VALUES(?,?,?)`, [sid, userId, createdAt])
  return sid
}

async function getSession(req) {
  const sid = req.cookies[COOKIE_NAME]
  if (!sid) return null
  const row = await get(`SELECT s.sid, s.user_id, s.createdAt, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.sid = ?`, [sid])
  if (!row) return null
  return { sid: row.sid, createdAt: row.createdAt, user: { id: row.user_id, email: row.email } }
}

// login route
app.post('/api/login', csrfProtection, authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: 'email and password required' })
    const user = await get(`SELECT id,email,password,verified FROM users WHERE email = ?`, [email])
    if (!user) return res.status(401).json({ error: 'invalid credentials' })
    const match = await bcrypt.compare(password, user.password)
    if (!match) return res.status(401).json({ error: 'invalid credentials' })
    if (!user.verified) return res.status(403).json({ error: 'email not verified' })
    const sid = await createSessionForUserId(user.id)
    res.cookie(COOKIE_NAME, sid, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 })
    return res.json({ ok: true, email: user.email })
  } catch (e) { console.error(e); return res.status(500).json({ error: 'server error' }) }
})

// register route with email verification
app.post('/api/register', csrfProtection, registerLimiter, async (req, res) => {
  try {
    const { email, password, confirmPassword } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: 'email and password required' })
    if (password !== confirmPassword) return res.status(400).json({ error: 'passwords do not match' })
    
    try {
      const hash = await bcrypt.hash(password, 10)
      const verificationToken = uuidv4()
      const verificationExpires = Date.now() + (24 * 60 * 60 * 1000) // 24 hours
      
      await run(
        `INSERT INTO users(email, password, verification_token, verification_expires) VALUES(?,?,?,?)`,
        [email, hash, verificationToken, verificationExpires]
      )
      
      // Send verification email
      await sendVerificationEmail(email, verificationToken)
      
      return res.json({ ok: true, message: 'verification email sent' })
    } catch (e) {
      // likely UNIQUE constraint
      if (e && e.message && e.message.indexOf('UNIQUE') !== -1) return res.status(409).json({ error: 'email already exists' })
      throw e
    }
  } catch (e) { console.error(e); return res.status(500).json({ error: 'server error' }) }
})

// get current user
app.get('/api/me', async (req, res) => {
  try {
    const s = await getSession(req)
    if (!s) return res.status(401).json({ error: 'not authenticated' })
    return res.json({ user: s.user })
  } catch (e) { console.error(e); return res.status(500).json({ error: 'server error' }) }
})

// change password
app.post('/api/change-password', csrfProtection, passwordChangeLimiter, async (req, res) => {
  try {
    const s = await getSession(req)
    if (!s) return res.status(401).json({ error: 'not authenticated' })
    
    const { currentPassword, newPassword } = req.body || {}
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'current password and new password required' })
    }
    
    // Validate new password length
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'new password must be at least 6 characters' })
    }
    
    // Get user with current password hash
    const user = await get(`SELECT id, password FROM users WHERE id = ?`, [s.user.id])
    if (!user) return res.status(404).json({ error: 'user not found' })
    
    // Verify current password
    const match = await bcrypt.compare(currentPassword, user.password)
    if (!match) {
      return res.status(401).json({ error: 'current password is incorrect' })
    }
    
    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 10)
    
    // Update password
    await run(`UPDATE users SET password = ? WHERE id = ?`, [newHash, user.id])
    
    return res.json({ ok: true, message: 'password changed successfully' })
  } catch (e) { 
    console.error(e)
    return res.status(500).json({ error: 'server error' }) 
  }
})

// logout
app.post('/api/logout', csrfProtection, async (req, res) => {
  try {
    const sid = req.cookies[COOKIE_NAME]
    if (sid) await run(`DELETE FROM sessions WHERE sid = ?`, [sid])
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax' })
    res.json({ ok: true })
  } catch (e) { console.error(e); return res.status(500).json({ error: 'server error' }) }
})

// save state for authenticated user
app.post('/api/state', csrfProtection, async (req, res) => {
  try {
    const s = await getSession(req)
    if (!s) return res.status(401).json({ error: 'not authenticated' })
    const userId = s.user.id
    const state = req.body && req.body.state
    if (typeof state === 'undefined') return res.status(400).json({ error: 'state missing in body' })
    const blob = JSON.stringify(state)
    await run(`INSERT OR REPLACE INTO states(user_id, state) VALUES(?,?)`, [userId, blob])
    return res.json({ ok: true })
  } catch (e) { console.error(e); return res.status(500).json({ error: 'server error' }) }
})

// get saved state for authenticated user
app.get('/api/state', async (req, res) => {
  try {
    const s = await getSession(req)
    if (!s) return res.status(401).json({ error: 'not authenticated' })
    const userId = s.user.id
    const row = await get(`SELECT state FROM states WHERE user_id = ?`, [userId])
    if (!row) return res.json({ state: null })
    try { return res.json({ state: JSON.parse(row.state) }) } catch (e) { return res.json({ state: null }) }
  } catch (e) { console.error(e); return res.status(500).json({ error: 'server error' }) }
})

// TomTom proxy - forwards queries to TomTom Search API using server-side key
app.get('/api/tomtom', async (req, res) => {
  try {
    const q = req.query.q
    if (!q) return res.status(400).json({ error: 'q query param required' })
    const key = process.env.TOMTOM_API_KEY
    if (!key) return res.status(500).json({ error: 'TomTom API key not configured on server' })
    // forward to TomTom
    const limit = req.query.limit || 6
    const typeahead = (typeof req.query.typeahead === 'undefined') ? 'true' : String(req.query.typeahead)
    const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${key}&limit=${encodeURIComponent(limit)}&typeahead=${encodeURIComponent(typeahead)}&entityTypeSet=Municipality`
    const r = await fetch(url)
    const json = await r.json()
    return res.json(json)
  } catch (e) {
    console.error('tomtom proxy failed', e)
    return res.status(500).json({ error: 'tomtom proxy failed' })
  }
})

app.listen(PORT, () => console.log(`Trippino listening on port: ${PORT}`))
