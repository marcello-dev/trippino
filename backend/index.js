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

// simple health
app.get('/api/health', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => console.log(`Trippino backend listening on http://localhost:${PORT}`))
