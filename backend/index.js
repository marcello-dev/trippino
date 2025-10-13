const express = require('express')
const cookieParser = require('cookie-parser')
const { v4: uuidv4 } = require('uuid')

const app = express()
const PORT = process.env.PORT || 4000

// Simple in-memory session store: { sessionId: { user } }
const sessions = new Map()

// For demo/demo-only: simple user store (username -> password)
const users = {
  'demo': 'demo',
  'alice': 'password123'
}

// persisted user state storage (username -> state object)
const fs = require('fs')
const path = require('path')
const DATA_FILE = path.join(__dirname, 'data.json')
let savedStates = {}

// load persisted data if present
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    savedStates = JSON.parse(raw || '{}')
  }
} catch (err) {
  console.error('failed to read data file', err)
  savedStates = {}
}

// cookie name
const COOKIE_NAME = 'trippino_sid'

app.use(express.json())
app.use(cookieParser())

// CORS-lite middleware to allow the static frontend (e.g., s3) to talk to this API
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

function createSessionForUser(username) {
  const sid = uuidv4()
  const session = { user: { username }, createdAt: Date.now() }
  sessions.set(sid, session)
  return sid
}

function getSession(req) {
  const sid = req.cookies[COOKIE_NAME]
  if (!sid) return null
  const s = sessions.get(sid)
  return s || null
}

// login route
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'username and password required' })
  const expected = users[username]
  if (!expected || expected !== password) return res.status(401).json({ error: 'invalid credentials' })

  const sid = createSessionForUser(username)

  // set cookie
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  })

  return res.json({ ok: true, username })
})

// register route: simple demo-only implementation that stores username/password in memory
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'username and password required' })
  if (users[username]) return res.status(409).json({ error: 'username already exists' })
  users[username] = password
  // create empty saved state for user
  savedStates[username] = savedStates[username] || null
  // persist
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(savedStates, null, 2)) } catch (e) { console.error('persist failed', e) }
  const sid = createSessionForUser(username)
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  })
  return res.json({ ok: true, username })
})

// get current user
app.get('/api/me', (req, res) => {
  const s = getSession(req)
  if (!s) return res.status(401).json({ error: 'not authenticated' })
  return res.json({ user: s.user })
})

// logout
app.post('/api/logout', (req, res) => {
  const sid = req.cookies[COOKIE_NAME]
  if (sid) sessions.delete(sid)
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax' })
  res.json({ ok: true })
})

// save state for authenticated user
app.post('/api/state', (req, res) => {
  const s = getSession(req)
  if (!s) return res.status(401).json({ error: 'not authenticated' })
  const username = s.user.username
  const state = req.body && req.body.state
  if (typeof state === 'undefined') return res.status(400).json({ error: 'state missing in body' })
  savedStates[username] = state
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(savedStates, null, 2)) } catch (e) { console.error('persist failed', e) }
  return res.json({ ok: true })
})

// get saved state for authenticated user
app.get('/api/state', (req, res) => {
  const s = getSession(req)
  if (!s) return res.status(401).json({ error: 'not authenticated' })
  const username = s.user.username
  return res.json({ state: savedStates[username] || null })
})

// simple health
app.get('/api/health', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => console.log(`Trippino backend listening on http://localhost:${PORT}`))
