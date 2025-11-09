/**
 * Authentication Tests
 * Tests for signup, login, logout, email verification, and password change
 */

import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  createTestDatabase,
  initTestDatabase,
  createTestUser,
  createTestSession,
  extractSessionCookie,
  extractCsrfToken,
  cleanupDatabase,
} from "./helpers.js";

// We'll need to mock the app setup
let app;
let db;
let run, get, all;

describe("Authentication API", () => {
  beforeEach(async () => {
    // Create fresh database for each test
    const testDb = createTestDatabase();
    db = testDb.db;
    run = testDb.run;
    get = testDb.get;
    all = testDb.all;

    await initTestDatabase(run);

    // Set up minimal Express app for testing
    app = express();
    app.use(express.json());
    app.use(cookieParser());

    // Add auth endpoints (simplified version of actual app.js)
    const COOKIE_NAME = "trippino_sid";
    const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

    // Helper to get session
    async function getSession(req) {
      const sid = req.cookies[COOKIE_NAME];
      if (!sid) return null;

      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);

      if (!session) return null;

      // Check if session expired
      const sessionAge = Date.now() - session.createdAt;
      if (sessionAge > SESSION_MAX_AGE) {
        await run(`DELETE FROM sessions WHERE sid = ?`, [sid]);
        return null;
      }

      const user = await get(
        `SELECT id, email, verified FROM users WHERE id = ?`,
        [session.user_id],
      );

      return user || null;
    }

    // POST /api/signup
    app.post("/api/signup", async (req, res) => {
      try {
        const { email, password } = req.body;

        if (!email || !password) {
          return res.status(400).json({ error: "Email and password required" });
        }

        if (password.length < 8) {
          return res
            .status(400)
            .json({ error: "Password must be at least 8 characters" });
        }

        const existingUser = await get(`SELECT id FROM users WHERE email = ?`, [
          email,
        ]);

        if (existingUser) {
          return res.status(400).json({ error: "Email already registered" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationToken = Math.random().toString(36).substring(2);
        const verificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

        const result = await run(
          `INSERT INTO users (email, password, verified, verification_token, verification_expires) 
           VALUES (?, ?, 0, ?, ?)`,
          [email, hashedPassword, verificationToken, verificationExpires],
        );

        // Email sending is skipped in tests (SKIP_EMAIL_SENDING=true)

        res.json({ ok: true, userId: result.lastID });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // POST /api/login
    app.post("/api/login", async (req, res) => {
      try {
        const { email, password } = req.body;

        if (!email || !password) {
          return res.status(400).json({ error: "Email and password required" });
        }

        const user = await get(`SELECT * FROM users WHERE email = ?`, [email]);

        if (!user) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        // Create session
        const sid = randomUUID();
        const createdAt = Date.now();

        await run(
          `INSERT INTO sessions (sid, user_id, createdAt) VALUES (?, ?, ?)`,
          [sid, user.id, createdAt],
        );

        res.cookie(COOKIE_NAME, sid, {
          httpOnly: true,
          sameSite: "lax",
          maxAge: SESSION_MAX_AGE,
        });

        res.json({
          ok: true,
          user: {
            id: user.id,
            email: user.email,
            verified: user.verified,
          },
        });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // POST /api/logout
    app.post("/api/logout", async (req, res) => {
      try {
        const sid = req.cookies[COOKIE_NAME];
        if (sid) {
          await run(`DELETE FROM sessions WHERE sid = ?`, [sid]);
        }

        res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax" });
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // GET /api/user
    app.get("/api/user", async (req, res) => {
      try {
        const user = await getSession(req);

        if (!user) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        res.json({
          id: user.id,
          email: user.email,
          verified: user.verified,
        });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // POST /api/verify-email
    app.post("/api/verify-email", async (req, res) => {
      try {
        const { token } = req.body;

        if (!token) {
          return res.status(400).json({ error: "Token required" });
        }

        const user = await get(
          `SELECT * FROM users WHERE verification_token = ?`,
          [token],
        );

        if (!user) {
          return res.status(400).json({ error: "Invalid token" });
        }

        if (Date.now() > user.verification_expires) {
          return res.status(400).json({ error: "Token expired" });
        }

        await run(
          `UPDATE users SET verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?`,
          [user.id],
        );

        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // POST /api/change-password
    app.post("/api/change-password", async (req, res) => {
      try {
        const user = await getSession(req);

        if (!user) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
          return res.status(400).json({ error: "Both passwords required" });
        }

        if (newPassword.length < 8) {
          return res
            .status(400)
            .json({ error: "Password must be at least 8 characters" });
        }

        const userWithPassword = await get(`SELECT * FROM users WHERE id = ?`, [
          user.id,
        ]);

        const passwordMatch = await bcrypt.compare(
          currentPassword,
          userWithPassword.password,
        );
        if (!passwordMatch) {
          return res.status(400).json({ error: "Current password incorrect" });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await run(`UPDATE users SET password = ? WHERE id = ?`, [
          hashedPassword,
          user.id,
        ]);

        // Invalidate all sessions for this user
        const deleteResult = await run(
          `DELETE FROM sessions WHERE user_id = ?`,
          [user.id],
        );

        res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax" });

        res.json({
          ok: true,
          sessionsInvalidated: deleteResult.changes || 0,
        });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });
  });

  afterEach(async () => {
    await cleanupDatabase(db);
  });

  describe("POST /api/signup", () => {
    it("should create a new user account", async () => {
      const response = await request(app).post("/api/signup").send({
        email: "newuser@example.com",
        password: "password123",
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.userId).toBeDefined();

      // Verify user was created
      const user = await get(`SELECT * FROM users WHERE email = ?`, [
        "newuser@example.com",
      ]);
      expect(user).toBeDefined();
      expect(user.verified).toBe(0);
      expect(user.verification_token).toBeDefined();
    });

    it("should reject signup with existing email", async () => {
      await createTestUser(run, "existing@example.com");

      const response = await request(app).post("/api/signup").send({
        email: "existing@example.com",
        password: "password123",
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("already registered");
    });

    it("should reject weak passwords", async () => {
      const response = await request(app).post("/api/signup").send({
        email: "test@example.com",
        password: "weak",
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("at least 8 characters");
    });

    it("should reject missing fields", async () => {
      const response = await request(app).post("/api/signup").send({
        email: "test@example.com",
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("required");
    });
  });

  describe("POST /api/login", () => {
    it("should login with valid credentials", async () => {
      await createTestUser(run, "user@example.com", "password123");

      const response = await request(app).post("/api/login").send({
        email: "user@example.com",
        password: "password123",
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.user.email).toBe("user@example.com");

      // Verify session cookie was set
      const cookie = extractSessionCookie(response);
      expect(cookie).toBeDefined();
      expect(cookie).toContain("trippino_sid=");
    });

    it("should reject invalid email", async () => {
      const response = await request(app).post("/api/login").send({
        email: "nonexistent@example.com",
        password: "password123",
      });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain("Invalid credentials");
    });

    it("should reject wrong password", async () => {
      await createTestUser(run, "user@example.com", "password123");

      const response = await request(app).post("/api/login").send({
        email: "user@example.com",
        password: "wrongpassword",
      });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain("Invalid credentials");
    });
  });

  describe("POST /api/logout", () => {
    it("should logout and clear session", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/logout")
        .set("Cookie", `trippino_sid=${sid}`);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      // Verify session was deleted
      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      expect(session).toBeUndefined();
    });

    it("should handle logout without session", async () => {
      const response = await request(app).post("/api/logout");

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });
  });

  describe("GET /api/user", () => {
    it("should return current user info", async () => {
      const user = await createTestUser(run, "user@example.com");
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .get("/api/user")
        .set("Cookie", `trippino_sid=${sid}`);

      expect(response.status).toBe(200);
      expect(response.body.email).toBe("user@example.com");
      expect(response.body.id).toBe(user.id);
    });

    it("should return 401 without session", async () => {
      const response = await request(app).get("/api/user");

      expect(response.status).toBe(401);
      expect(response.body.error).toContain("Not authenticated");
    });

    it("should return 401 with expired session", async () => {
      const user = await createTestUser(run);
      const sid = randomUUID();

      // Create expired session (8 days ago)
      const expiredTime = Date.now() - 8 * 24 * 60 * 60 * 1000;
      await run(
        `INSERT INTO sessions (sid, user_id, createdAt) VALUES (?, ?, ?)`,
        [sid, user.id, expiredTime],
      );

      const response = await request(app)
        .get("/api/user")
        .set("Cookie", `trippino_sid=${sid}`);

      expect(response.status).toBe(401);

      // Verify expired session was deleted
      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      expect(session).toBeUndefined();
    });
  });

  describe("POST /api/verify-email", () => {
    it("should verify email with valid token", async () => {
      const token = "valid-token-123";
      const expires = Date.now() + 24 * 60 * 60 * 1000;

      await run(
        `INSERT INTO users (email, password, verified, verification_token, verification_expires) 
         VALUES (?, ?, 0, ?, ?)`,
        ["user@example.com", "hashed", token, expires],
      );

      const response = await request(app)
        .post("/api/verify-email")
        .send({ token });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      // Verify user is now verified
      const user = await get(`SELECT * FROM users WHERE email = ?`, [
        "user@example.com",
      ]);
      expect(user.verified).toBe(1);
      expect(user.verification_token).toBeNull();
    });

    it("should reject invalid token", async () => {
      const response = await request(app)
        .post("/api/verify-email")
        .send({ token: "invalid-token" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid token");
    });

    it("should reject expired token", async () => {
      const token = "expired-token";
      const expires = Date.now() - 1000; // Already expired

      await run(
        `INSERT INTO users (email, password, verified, verification_token, verification_expires) 
         VALUES (?, ?, 0, ?, ?)`,
        ["user@example.com", "hashed", token, expires],
      );

      const response = await request(app)
        .post("/api/verify-email")
        .send({ token });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("expired");
    });
  });

  describe("POST /api/change-password", () => {
    it("should change password and invalidate all sessions", async () => {
      const user = await createTestUser(run, "user@example.com", "oldpassword");
      const sid1 = await createTestSession(run, user.id);
      const sid2 = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/change-password")
        .set("Cookie", `trippino_sid=${sid1}`)
        .send({
          currentPassword: "oldpassword",
          newPassword: "newpassword123",
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.sessionsInvalidated).toBe(2);

      // Verify password was changed
      const updatedUser = await get(`SELECT * FROM users WHERE id = ?`, [
        user.id,
      ]);
      const passwordMatch = await bcrypt.compare(
        "newpassword123",
        updatedUser.password,
      );
      expect(passwordMatch).toBe(true);

      // Verify all sessions were deleted
      const sessions = await all(`SELECT * FROM sessions WHERE user_id = ?`, [
        user.id,
      ]);
      expect(sessions.length).toBe(0);
    });

    it("should reject wrong current password", async () => {
      const user = await createTestUser(
        run,
        "user@example.com",
        "correctpassword",
      );
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/change-password")
        .set("Cookie", `trippino_sid=${sid}`)
        .send({
          currentPassword: "wrongpassword",
          newPassword: "newpassword123",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("incorrect");
    });

    it("should reject weak new password", async () => {
      const user = await createTestUser(run, "user@example.com", "oldpassword");
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/change-password")
        .set("Cookie", `trippino_sid=${sid}`)
        .send({
          currentPassword: "oldpassword",
          newPassword: "weak",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("at least 8 characters");
    });

    it("should require authentication", async () => {
      const response = await request(app).post("/api/change-password").send({
        currentPassword: "old",
        newPassword: "newpassword123",
      });

      expect(response.status).toBe(401);
    });
  });
});
