import express from "express";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import csrf from "csurf";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import registerTripRoutes from "./routes/trips.js";
import registerCityRoutes from "./routes/cities.js";
import registerTransportationRoutes, {
  TRANSPORT_MODES,
} from "./routes/transportation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// cookie name
export const COOKIE_NAME = "trippino_sid";

// Matches the client-side check in public/auth.html
const MIN_REGISTER_PASSWORD_LENGTH = 8;

// Session configuration
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Delete sessions older than SESSION_MAX_AGE, returns the number deleted
export async function deleteExpiredSessions(run, now = Date.now()) {
  const cutoff = now - SESSION_MAX_AGE;
  const result = await run(`DELETE FROM sessions WHERE createdAt < ?`, [
    cutoff,
  ]);
  return result.changes;
}

/**
 * Build the Express app.
 *
 * @param {object} deps
 * @param {Function} deps.run - promisified sqlite run
 * @param {Function} deps.get - promisified sqlite get
 * @param {Function} deps.all - promisified sqlite all
 * @param {Function} deps.transaction - async (fn) => fn's result, run in a transaction
 * @param {Function} deps.sendVerificationEmail - async (email, token) => void
 * @param {object} deps.config
 * @param {string} deps.config.apiBase
 * @param {string} deps.config.tomtomApiKey
 * @param {boolean} deps.config.isProduction
 * @param {boolean} deps.config.skipEmailSending
 */
export function createApp({
  run,
  get,
  all,
  transaction,
  sendVerificationEmail,
  config,
}) {
  const { apiBase, tomtomApiKey, isProduction, skipEmailSending } = config;

  const app = express();

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
      hsts: isProduction ? undefined : false, // don't set HSTS on localhost/dev
    }),
  );

  // --- CSRF Protection ---
  const csrfProtection = csrf({
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: isProduction,
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
      const ip = req.ip ?? req.socket?.remoteAddress;
      return ip ? ipKeyGenerator(ip) : "unknown";
    },
  });

  // Moderate rate limiter for registration (prevent spam account creation)
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 registrations per hour per IP
    message: {
      error: "Too many registration attempts, please try again later",
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip ?? req.socket?.remoteAddress;
      return ip ? ipKeyGenerator(ip) : "unknown";
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
      const ip = req.ip ?? req.socket?.remoteAddress;
      const resolvedIp = ip ? ipKeyGenerator(ip) : "unknown";
      return req.cookies[COOKIE_NAME] || resolvedIp;
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
      const ip = req.ip ?? req.socket?.remoteAddress;
      return ip ? ipKeyGenerator(ip) : "unknown";
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
      `window.APP_CONFIG = { API_BASE: "${apiBase}", TOMTOM_API_KEY: "${tomtomApiKey}" };`,
    );
  });

  // --- Register trip and city routes in separate modules ---
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
  registerTransportationRoutes(app, {
    csrfProtection,
    getSession,
    run,
    get,
    all,
  });

  async function createSessionForUserId(userId) {
    const sid = randomUUID();
    const createdAt = Date.now();
    await run(`INSERT INTO sessions(sid, user_id, createdAt) VALUES(?,?,?)`, [
      sid,
      userId,
      createdAt,
    ]);
    return sid;
  }

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
        secure: isProduction,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      return res.json({ ok: true, email: user.email });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "server error" });
    }
  });

  // register route with email verification
  app.post(
    "/api/register",
    csrfProtection,
    registerLimiter,
    async (req, res) => {
      try {
        const { email, password, confirmPassword } = req.body || {};
        if (!email || !password)
          return res.status(400).json({ error: "email and password required" });
        if (password !== confirmPassword)
          return res.status(400).json({ error: "passwords do not match" });
        if (password.length < MIN_REGISTER_PASSWORD_LENGTH)
          return res.status(400).json({
            error: `password must be at least ${MIN_REGISTER_PASSWORD_LENGTH} characters`,
          });

        try {
          const hash = await bcrypt.hash(password, 10);

          if (skipEmailSending) {
            // Skip email verification - create user as verified
            await run(
              `INSERT INTO users(email, password, verified) VALUES(?,?,1)`,
              [email, hash],
            );
            console.log(
              `[Registration] Email sending disabled - user ${email} created as verified`,
            );
            return res.json({
              ok: true,
              message: "account created successfully",
            });
          } else {
            // Normal flow with email verification
            const verificationToken = randomUUID();
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
    },
  );

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
          return res
            .status(401)
            .json({ error: "current password is incorrect" });
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

  async function loadState(userId) {
    const trips = await all(
      `SELECT id, name, start_date FROM trips WHERE user_id = ?`,
      [userId],
    );
    if (!trips || trips.length === 0) return null;

    const tripIds = trips.map((trip) => trip.id);
    const placeholders = tripIds.map(() => "?").join(", ");

    const cities = await all(
      `SELECT id, name, nights, notes, latitude, longitude, sort_order, trip_id FROM cities WHERE trip_id IN (${placeholders})`,
      tripIds,
    );

    const transportation = await all(
      `SELECT id, trip_id, from_city_id, to_city_id, mode, notes FROM transportation WHERE trip_id IN (${placeholders})`,
      tripIds,
    );

    return {
      trips: trips.map((trip) => ({
        id: trip.id,
        name: trip.name,
        start_date: trip.start_date,
        cities: cities.filter((city) => city.trip_id === trip.id),
        transportation: transportation.filter((t) => t.trip_id === trip.id),
      })),
    };
  }

  // Returns an error message for the first invalid local trip or city, or null
  function validateLocalTrips(trips) {
    for (const trip of trips) {
      if (!trip || typeof trip !== "object") return "invalid trip";
      if (!trip.name || !String(trip.name).trim()) return "trip name required";
      if (trip.start_date && !/^\d{4}-\d{2}-\d{2}$/.test(trip.start_date))
        return "start_date must be in YYYY-MM-DD format";
      if (trip.cities !== undefined && !Array.isArray(trip.cities))
        return "invalid cities";
      for (const city of trip.cities || []) {
        if (!city || !city.name || !String(city.name).trim())
          return "city name required";
        const nights = Number(city.nights ?? 0);
        if (!Number.isFinite(nights) || nights < 0)
          return "nights must be a non-negative number";
      }
    }
    return null;
  }

  function coordinateOrNull(value, limit) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= -limit && n <= limit ? n : null;
  }

  function sameId(a, b) {
    return a !== null && a !== undefined && String(a) === String(b);
  }

  // Save the local (pre-login) state into the database on first login and
  // return it as stored, with database ids
  app.post("/api/state/firstlogin", csrfProtection, async (req, res) => {
    try {
      const s = await getSession(req);
      if (!s) return res.status(401).json({ error: "not authenticated" });
      const userId = s.user.id;
      const state = req.body && req.body.state;
      if (!state || typeof state !== "object")
        return res.status(400).json({ error: "state missing in body" });

      const trips = Array.isArray(state.trips) ? state.trips : [];
      const invalid = validateLocalTrips(trips);
      if (invalid) return res.status(400).json({ error: invalid });

      await transaction(async () => {
        for (const trip of trips) {
          const result = await run(
            `INSERT INTO trips(name, start_date, user_id) VALUES(?,?,?)`,
            [String(trip.name).trim(), trip.start_date || null, userId],
          );
          const tripId = result.lastID;

          const cities = trip.cities || [];
          const cityIds = [];
          for (const [index, city] of cities.entries()) {
            const lat = coordinateOrNull(city.latitude, 90);
            const lon = coordinateOrNull(city.longitude, 180);
            const hasCoords = lat !== null && lon !== null;
            const cityResult = await run(
              `INSERT INTO cities(name, nights, notes, latitude, longitude, sort_order, trip_id) VALUES(?,?,?,?,?,?,?)`,
              [
                String(city.name).trim(),
                Number(city.nights ?? 0),
                typeof city.notes === "string" && city.notes.trim() !== ""
                  ? city.notes
                  : null,
                hasCoords ? lat : null,
                hasCoords ? lon : null,
                index,
                tripId,
              ],
            );
            cityIds.push(cityResult.lastID);
          }

          // Legs are only valid between consecutive cities, one per city
          const legs = Array.isArray(trip.transportation)
            ? trip.transportation
            : [];
          const savedFrom = new Set();
          for (const leg of legs) {
            if (!leg || !TRANSPORT_MODES.has(leg.mode)) continue;
            const fromIdx = cities.findIndex((c) =>
              sameId(c.id, leg.from_city_id),
            );
            const next = cities[fromIdx + 1];
            if (fromIdx === -1 || !next || !sameId(next.id, leg.to_city_id))
              continue;
            if (savedFrom.has(fromIdx)) continue;
            savedFrom.add(fromIdx);
            await run(
              `INSERT INTO transportation(trip_id, from_city_id, to_city_id, mode, notes) VALUES (?,?,?,?,?)`,
              [
                tripId,
                cityIds[fromIdx],
                cityIds[fromIdx + 1],
                leg.mode,
                typeof leg.notes === "string" ? leg.notes.trim() : null,
              ],
            );
          }
        }
      });

      const saved = await loadState(userId);
      return res.json({ ok: true, state: saved || { trips: [] } });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "server error" });
    }
  });

  // Build the user's state from the trips, cities and transportation tables
  app.get("/api/state", async (req, res) => {
    try {
      const s = await getSession(req);
      if (!s) return res.status(401).json({ error: "not authenticated" });
      const state = await loadState(s.user.id);
      return res.json({ state });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "server error" });
    }
  });

  return app;
}
