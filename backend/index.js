const express = require('express')
const cookieParser = require('cookie-parser')
const { v4: uuidv4 } = require('uuid')
const bcrypt = require('bcryptjs')

const app = express()
const PORT = process.env.PORT || 4000

const fs = require('fs')
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
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT)`)
  db.run(`CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, user_id INTEGER, createdAt INTEGER)`)
  db.run(`CREATE TABLE IF NOT EXISTS states (user_id INTEGER PRIMARY KEY, state TEXT)`)
  // seed demo users with hashed passwords
  try {
    const marcHash = bcrypt.hashSync('marc', 10)
    db.run(`INSERT OR IGNORE INTO users(email,password) VALUES(?,?)`, ['marc@demo.com', marcHash])
  } catch (e) {
    console.error('failed seeding users', e)
  }
})

// cookie name
const COOKIE_NAME = 'trippino_sid'

app.use(express.json())
app.use(cookieParser())

// CORS-lite middleware to allow the static frontend to talk to this API
app.use((req, res, next) => {
  // allow any origin for now; in production lock this down
  const origin = req.get('Origin') || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

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
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: 'email and password required' })
    const user = await get(`SELECT id,email,password FROM users WHERE email = ?`, [email])
    if (!user) return res.status(401).json({ error: 'invalid credentials' })
    const match = await bcrypt.compare(password, user.password)
    if (!match) return res.status(401).json({ error: 'invalid credentials' })
    const sid = await createSessionForUserId(user.id)
    res.cookie(COOKIE_NAME, sid, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 })
    return res.json({ ok: true, email: user.email })
  } catch (e) { console.error(e); return res.status(500).json({ error: 'server error' }) }
})

// register route: simple demo-only implementation that stores email/password in memory
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: 'email and password required' })
    // hash password before storing
    try {
      const hash = await bcrypt.hash(password, 10)
      const info = await run(`INSERT INTO users(email,password) VALUES(?,?)`, [email, hash])
      // get id of created user
      const row = await get(`SELECT id FROM users WHERE email = ?`, [email])
      const sid = await createSessionForUserId(row.id)
      res.cookie(COOKIE_NAME, sid, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 })
      return res.json({ ok: true, email })
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

// logout
app.post('/api/logout', async (req, res) => {
  try {
    const sid = req.cookies[COOKIE_NAME]
    if (sid) await run(`DELETE FROM sessions WHERE sid = ?`, [sid])
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax' })
    res.json({ ok: true })
  } catch (e) { console.error(e); return res.status(500).json({ error: 'server error' }) }
})

// save state for authenticated user
app.post('/api/state', async (req, res) => {
  try {
    const s = await getSession(req)
    if (!s) return res.status(401).json({ error: 'not authenticated' })
    const userId = s.user.id
    const state = req.body && req.body.state
    if (typeof state === 'undefined') return res.status(400).json({ error: 'state missing in body' })
    const blob = JSON.stringify(state)
    await run(`INSERT OR REPLACE INTO states(user_id, state) VALUES(?,?)`, [userId, blob])
    console.log(`Saved state for user ${s.user.email} (id ${userId}), ${blob.length} bytes`)
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

// simple health
app.get('/api/health', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => console.log(`Trippino backend listening on http://localhost:${PORT}`))
