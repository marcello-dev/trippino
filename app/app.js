import express from "express";
import cookieParser from "cookie-parser";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import csrf from "csurf";
import helmet from "helmet";

const app = express();
const PORT = process.env.PORT;
const API_BASE =
  process.env.NODE_ENV == "production"
    ? process.env.API_BASE
    : `http://localhost:${PORT}`;
const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY || "";

// Email configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

async function sendVerificationEmail(email, token) {
  const verificationUrl = `${API_BASE}/verify-email.html?token=${token}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Verify your email for Trippino",
    html: `
      <h1>Welcome to Trippino!</h1>
      <p>Please click the link below to verify your email address:</p>
      <p><a href="${verificationUrl}">Verify my email</a></p>
      <p>If you didn't create an account, you can ignore this email.</p>
    `,
  });
}

import path from "path";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL =
  process.env["DATABASE_URL"] || path.join(__dirname, "data.sqlite");
console.log("SQLite DB path:", DATABASE_URL);

// open DB
const db = new sqlite3.Database(DATABASE_URL);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
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
  )`);
  db.run(
    `CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY, 
      user_id INTEGER, 
      createdAt INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  );
  db.run(`CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    nights INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    trip_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
  )`);
});

// cookie name
const COOKIE_NAME = "trippino_sid";

app.use(express.json());
app.use(cookieParser());

// --- Security Headers ---
// Disable Express x-powered-by header explicitly (defense in depth)
app.disable("x-powered-by");
// Apply Helmet with conservative defaults that won't break inline scripts/CSP
app.use(
  helmet({
    contentSecurityPolicy: false, // keep disabled for now due to inline scripts and CDN usage
    crossOriginEmbedderPolicy: false, // avoid COEP issues with third-party resources
    hsts: process.env.NODE_ENV === "production" ? undefined : false, // don't set HSTS on localhost/dev
  }),
);

// --- CSRF Protection ---
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  },
});

// --- Rate Limiters ---

// Strict rate limiter for authentication endpoints (login, register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: "Too many attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  // Use IP address as identifier
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
});

// Moderate rate limiter for registration (prevent spam account creation)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: { error: "Too many registration attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
});

// Rate limiter for password change (prevent brute force on current password)
const passwordChangeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 password change attempts per hour
  message: {
    error: "Too many password change attempts, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use session ID if available, otherwise IP
    return req.cookies[COOKIE_NAME] || req.ip || req.connection.remoteAddress;
  },
});

// General API rate limiter (prevent abuse of all endpoints)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: { error: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
  // Skip rate limiting for health check
  skip: (req) => req.path === "/api/health",
});

// Apply general API rate limiter to all /api routes
app.use("/api", apiLimiter);

// --- API Health Check ---
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Get CSRF token endpoint
app.get("/api/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Verify email endpoint
app.get("/api/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token)
      return res.status(400).json({ error: "verification token required" });

    const user = await get(
      `SELECT id FROM users WHERE verification_token = ? AND verification_expires > ? AND verified = 0`,
      [token, Date.now()],
    );

    if (!user)
      return res
        .status(400)
        .json({ error: "invalid or expired verification token" });

    await run(
      `UPDATE users SET verified = 1, verification_token = NULL WHERE id = ?`,
      [user.id],
    );

    return res.json({ ok: true, message: "email verified successfully" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
});

// --- Serve frontend files ---
app.use(express.static(path.join(__dirname, "public")));

// --- Dynamic config.js ---
app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.send(
    `window.APP_CONFIG = { API_BASE: "${API_BASE}", TOMTOM_API_KEY: "${TOMTOM_API_KEY}" };`,
  );
});

// --- Register trip and city routes in separate modules ---
import registerTripRoutes from "./routes/trips.js";
import registerCityRoutes from "./routes/cities.js";

registerTripRoutes(app, {
  csrfProtection,
  getSession,
  run,
  get,
});
registerCityRoutes(app, {
  csrfProtection,
  getSession,
  run,
  get,
});

async function createSessionForUserId(userId) {
  const sid = uuidv4();
  const createdAt = Date.now();
  await run(`INSERT INTO sessions(sid, user_id, createdAt) VALUES(?,?,?)`, [
    sid,
    userId,
    createdAt,
  ]);
  return sid;
}

// Session configuration
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

async function getSession(req) {
  const sid = req.cookies[COOKIE_NAME];
  if (!sid) return null;
  const row = await get(
    `SELECT s.sid, s.user_id, s.createdAt, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.sid = ?`,
    [sid],
  );
  if (!row) return null;

  // Check if session has expired
  const sessionAge = Date.now() - row.createdAt;
  if (sessionAge > SESSION_MAX_AGE) {
    // Session expired, delete it
    await run(`DELETE FROM sessions WHERE sid = ?`, [sid]);
    return null;
  }

  return {
    sid: row.sid,
    createdAt: row.createdAt,
    user: { id: row.user_id, email: row.email },
  };
}

// login route
app.post("/api/login", csrfProtection, authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: "email and password required" });
    const user = await get(
      `SELECT id,email,password,verified FROM users WHERE email = ?`,
      [email],
    );
    if (!user) return res.status(401).json({ error: "invalid credentials" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "invalid credentials" });
    if (!user.verified)
      return res.status(403).json({ error: "email not verified" });
    const sid = await createSessionForUserId(user.id);
    res.cookie(COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.json({ ok: true, email: user.email });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
});

// register route with email verification
app.post("/api/register", csrfProtection, registerLimiter, async (req, res) => {
  try {
    const { email, password, confirmPassword } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: "email and password required" });
    if (password !== confirmPassword)
      return res.status(400).json({ error: "passwords do not match" });

    try {
      const hash = await bcrypt.hash(password, 10);

      // Check if email sending is disabled (for development/testing)
      const skipEmail = process.env.SKIP_EMAIL_SENDING === "true";

      if (skipEmail) {
        // Skip email verification - create user as verified
        await run(
          `INSERT INTO users(email, password, verified) VALUES(?,?,1)`,
          [email, hash],
        );
        console.log(
          `[Registration] Email sending disabled - user ${email} created as verified`,
        );
        return res.json({ ok: true, message: "account created successfully" });
      } else {
        // Normal flow with email verification
        const verificationToken = uuidv4();
        const verificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

        await run(
          `INSERT INTO users(email, password, verification_token, verification_expires) VALUES(?,?,?,?)`,
          [email, hash, verificationToken, verificationExpires],
        );

        // Send verification email
        await sendVerificationEmail(email, verificationToken);

        return res.json({ ok: true, message: "verification email sent" });
      }
    } catch (e) {
      // likely UNIQUE constraint
      if (e && e.message && e.message.indexOf("UNIQUE") !== -1)
        return res.status(409).json({ error: "email already exists" });
      throw e;
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
});

// get current user
app.get("/api/me", async (req, res) => {
  try {
    const s = await getSession(req);
    if (!s) return res.status(401).json({ error: "not authenticated" });
    return res.json({ user: s.user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
});

// change password
app.post(
  "/api/change-password",
  csrfProtection,
  passwordChangeLimiter,
  async (req, res) => {
    try {
      const s = await getSession(req);
      if (!s) return res.status(401).json({ error: "not authenticated" });

      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return res
          .status(400)
          .json({ error: "current password and new password required" });
      }

      // Validate new password length
      if (newPassword.length < 6) {
        return res
          .status(400)
          .json({ error: "new password must be at least 6 characters" });
      }

      // Get user with current password hash
      const user = await get(`SELECT id, password FROM users WHERE id = ?`, [
        s.user.id,
      ]);
      if (!user) return res.status(404).json({ error: "user not found" });

      // Verify current password
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) {
        return res.status(401).json({ error: "current password is incorrect" });
      }

      // Hash new password
      const newHash = await bcrypt.hash(newPassword, 10);

      // Update password
      await run(`UPDATE users SET password = ? WHERE id = ?`, [
        newHash,
        user.id,
      ]);

      // Invalidate all sessions for this user (force re-login on all devices)
      const result = await run(`DELETE FROM sessions WHERE user_id = ?`, [
        user.id,
      ]);
      console.log(
        `[Password Change] Invalidated ${result.changes} session(s) for user ${user.id}`,
      );

      // Clear current session cookie
      res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax" });

      return res.json({ ok: true, message: "password changed successfully" });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "server error" });
    }
  },
);

// logout
app.post("/api/logout", csrfProtection, async (req, res) => {
  try {
    const sid = req.cookies[COOKIE_NAME];
    if (sid) await run(`DELETE FROM sessions WHERE sid = ?`, [sid]);
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
});

app.delete("/api/me", csrfProtection, async (req, res) => {
  try {
    const s = await getSession(req);
    if (!s) return res.status(401).json({ error: "not authenticated" });

    const userId = s.user.id;

    // Delete user (CASCADE will handle sessions, trips, and cities)
    await run("PRAGMA foreign_keys = ON");
    await run(`DELETE FROM users WHERE id = ?`, [userId]);

    // Clear session cookie
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax" });

    console.log(`[Account Deletion] User ${userId} deleted successfully`);
    return res.json({ ok: true, message: "account deleted successfully" });
  } catch (e) {
    console.error("[Account Deletion] Error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

// Save state for the first time login into database tables
app.post("/api/state/firstlogin", csrfProtection, async (req, res) => {
  try {
    const s = await getSession(req);
    if (!s) return res.status(401).json({ error: "not authenticated" });
    const userId = s.user.id;
    const state = req.body && req.body.state;
    // Log full nested structure (trips with their cities) for debugging
    console.log(
      "first login: saving state =>\n" + JSON.stringify(state, null, 2),
    );
    if (typeof state === "undefined")
      return res.status(400).json({ error: "state missing in body" });
    // Save state for first time login into trips and cities tables
    const trips = state.trips || [];
    for (const trip of trips) {
      const result = await run(
        `INSERT INTO trips(name, start_date, user_id) VALUES(?,?,?)`,
        [trip.name, trip.start_date || null, userId],
      );
      const tripId = result.lastID;
      const cities = trip.cities || [];
      let sort_order = 0;
      for (const city of cities) {
        await run(
          `INSERT INTO cities(name, nights, notes, sort_order, trip_id) VALUES(?,?,?,?,?)`,
          [city.name, city.nights || 0, city.notes, sort_order, tripId],
        );
        sort_order += 1;
      }
    }
    // return state with new Ids
    const newState = {
      trips: trips.map((trip) => ({
        id: trip.id,
        name: trip.name,
        start_date: trip.start_date,
        cities: trip.cities.map((city) => ({
          id: city.id,
          name: city.name,
          nights: city.nights,
          notes: city.notes,
          sort_order: city.sort_order,
        })),
      })),
    };
    return res.json({ ok: true, state: newState });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
});

// Checks if user has trips, if yes will build a state from trips and cities tables and return it
app.get("/api/state", async (req, res) => {
  try {
    const s = await getSession(req);
    if (!s) return res.status(401).json({ error: "not authenticated" });
    const userId = s.user.id;

    const trips = await all(
      `SELECT id, name, start_date FROM trips WHERE user_id = ?`,
      [userId],
    );
    if (!trips || trips.length === 0) return res.json({ state: null });

    const cities = await all(
      `SELECT id, name, nights, notes, latitude, longitude, sort_order, trip_id FROM cities WHERE trip_id IN (${trips.map(() => "?").join(", ")})`,
      trips.map((trip) => trip.id),
    );

    const state = {
      trips: trips.map((trip) => ({
        id: trip.id,
        name: trip.name,
        start_date: trip.start_date,
        cities: cities.filter((city) => city.trip_id === trip.id),
      })),
    };
    return res.json({ state });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
});

// Update a trip's name and/or start_date
app.put("/api/trips/:id", csrfProtection, async (req, res) => {
  try {
    const s = await getSession(req);
    if (!s) return res.status(401).json({ error: "not authenticated" });

    const tripId = parseInt(req.params.id, 10);
    if (!tripId || !Number.isInteger(tripId)) {
      return res.status(400).json({ error: "invalid trip id" });
    }

    const { name, start_date } = req.body || {};

    const hasName = typeof name !== "undefined";
    const hasStart = typeof start_date !== "undefined";
    if (!hasName && !hasStart) {
      return res.status(400).json({ error: "no fields to update" });
    }

    // Verify ownership
    const trip = await get(
      `SELECT id, name, start_date FROM trips WHERE id = ? AND user_id = ?`,
      [tripId, s.user.id],
    );
    if (!trip) {
      return res.status(404).json({ error: "trip not found or unauthorized" });
    }

    const sets = [];
    const params = [];

    if (hasName) {
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: "trip name required" });
      }
      sets.push("name = ?");
      params.push(String(name).trim());
    }

    if (hasStart) {
      let sd = start_date;
      if (sd === "") sd = null; // normalize empty string to null
      if (sd && !/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
        return res
          .status(400)
          .json({ error: "start_date must be in YYYY-MM-DD format" });
      }
      sets.push("start_date = ?");
      params.push(sd || null);
    }

    // Always bump updated_at
    const sql = `UPDATE trips SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    params.push(tripId);
    await run(sql, params);

    const updated = await get(
      `SELECT id, name, start_date FROM trips WHERE id = ? AND user_id = ?`,
      [tripId, s.user.id],
    );
    return res.json({ ok: true, trip: updated });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
});

// Background job: Clean up expired sessions every hour
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
setInterval(async () => {
  try {
    const cutoff = Date.now() - SESSION_MAX_AGE;
    const result = await run(`DELETE FROM sessions WHERE createdAt < ?`, [
      cutoff,
    ]);
    if (result.changes > 0) {
      console.log(
        `[Session Cleanup] Deleted ${result.changes} expired session(s)`,
      );
    }
  } catch (e) {
    console.error("[Session Cleanup] Error:", e);
  }
}, CLEANUP_INTERVAL);

app.listen(PORT, () => console.log(`Trippino listening on port: ${PORT}`));
