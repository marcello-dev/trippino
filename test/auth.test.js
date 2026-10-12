/**
 * Authentication Tests
 * Tests for register, login, logout, email verification, current user and
 * password change against the real app.
 */

import request from "supertest";
import bcrypt from "bcryptjs";
import {
  createTestContext,
  authHeaders,
  sessionCookie,
  createTestUser,
  createTestSession,
  extractCookie,
  findSetCookie,
} from "./helpers.js";

describe("Authentication API", () => {
  let ctx;
  let app, run, get, all;

  beforeEach(async () => {
    ctx = await createTestContext();
    ({ app, run, get, all } = ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  describe("POST /api/register", () => {
    it("should create an unverified user and send a verification email", async () => {
      const response = await request(app)
        .post("/api/register")
        .set(await authHeaders(app))
        .send({
          email: "newuser@example.com",
          password: "password123",
          confirmPassword: "password123",
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        message: "verification email sent",
      });

      const user = await get(`SELECT * FROM users WHERE email = ?`, [
        "newuser@example.com",
      ]);
      expect(user.verified).toBe(0);
      expect(user.verification_token).toBeTruthy();
      expect(user.verification_expires).toBeGreaterThan(Date.now());
      expect(await bcrypt.compare("password123", user.password)).toBe(true);

      expect(ctx.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(ctx.sendVerificationEmail).toHaveBeenCalledWith(
        "newuser@example.com",
        user.verification_token,
      );
    });

    it("should create a verified user without email when sending is skipped", async () => {
      const skipCtx = await createTestContext({ skipEmailSending: true });
      try {
        const response = await request(skipCtx.app)
          .post("/api/register")
          .set(await authHeaders(skipCtx.app))
          .send({
            email: "newuser@example.com",
            password: "password123",
            confirmPassword: "password123",
          });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe("account created successfully");

        const user = await skipCtx.get(`SELECT * FROM users WHERE email = ?`, [
          "newuser@example.com",
        ]);
        expect(user.verified).toBe(1);
        expect(skipCtx.sendVerificationEmail).not.toHaveBeenCalled();
      } finally {
        await skipCtx.close();
      }
    });

    it("should reject an existing email with 409", async () => {
      await createTestUser(run, "existing@example.com");

      const response = await request(app)
        .post("/api/register")
        .set(await authHeaders(app))
        .send({
          email: "existing@example.com",
          password: "password123",
          confirmPassword: "password123",
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("email already exists");
      expect(ctx.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it("should reject passwords shorter than 8 characters", async () => {
      const response = await request(app)
        .post("/api/register")
        .set(await authHeaders(app))
        .send({
          email: "test@example.com",
          password: "short12",
          confirmPassword: "short12",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "password must be at least 8 characters",
      );
      expect(
        await get(`SELECT * FROM users WHERE email = ?`, ["test@example.com"]),
      ).toBeUndefined();
    });

    it("should reject mismatched passwords", async () => {
      const response = await request(app)
        .post("/api/register")
        .set(await authHeaders(app))
        .send({
          email: "test@example.com",
          password: "password123",
          confirmPassword: "different",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("passwords do not match");
    });

    it("should reject missing fields", async () => {
      const response = await request(app)
        .post("/api/register")
        .set(await authHeaders(app))
        .send({ email: "test@example.com" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("email and password required");
    });

    it("should require a CSRF token", async () => {
      const response = await request(app).post("/api/register").send({
        email: "test@example.com",
        password: "password123",
        confirmPassword: "password123",
      });

      expect(response.status).toBe(403);
      const user = await get(`SELECT * FROM users WHERE email = ?`, [
        "test@example.com",
      ]);
      expect(user).toBeUndefined();
    });

    it("should rate limit registrations to 3 per hour", async () => {
      const headers = await authHeaders(app);
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/api/register")
          .set(headers)
          .send({
            email: `user${i}@example.com`,
            password: "password123",
            confirmPassword: "password123",
          });
        expect(res.status).toBe(200);
      }

      const response = await request(app)
        .post("/api/register")
        .set(headers)
        .send({
          email: "user4@example.com",
          password: "password123",
          confirmPassword: "password123",
        });

      expect(response.status).toBe(429);
    });
  });

  describe("POST /api/login", () => {
    it("should login with valid credentials and set a session cookie", async () => {
      const user = await createTestUser(run, "user@example.com", "password123");

      const response = await request(app)
        .post("/api/login")
        .set(await authHeaders(app))
        .send({ email: "user@example.com", password: "password123" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true, email: "user@example.com" });

      const setCookie = findSetCookie(response);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);

      const sid = extractCookie(response).split("=")[1];
      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      expect(session.user_id).toBe(user.id);
    });

    it("should return a session that authenticates /api/me", async () => {
      await createTestUser(run, "user@example.com", "password123");

      const login = await request(app)
        .post("/api/login")
        .set(await authHeaders(app))
        .send({ email: "user@example.com", password: "password123" });

      const me = await request(app)
        .get("/api/me")
        .set("Cookie", extractCookie(login));

      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe("user@example.com");
    });

    it("should reject an unknown email", async () => {
      const response = await request(app)
        .post("/api/login")
        .set(await authHeaders(app))
        .send({ email: "nonexistent@example.com", password: "password123" });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("invalid credentials");
    });

    it("should reject a wrong password", async () => {
      await createTestUser(run, "user@example.com", "password123");

      const response = await request(app)
        .post("/api/login")
        .set(await authHeaders(app))
        .send({ email: "user@example.com", password: "wrongpassword" });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("invalid credentials");
      expect(extractCookie(response)).toBeNull();
    });

    it("should reject an unverified user", async () => {
      await createTestUser(run, "user@example.com", "password123", 0);

      const response = await request(app)
        .post("/api/login")
        .set(await authHeaders(app))
        .send({ email: "user@example.com", password: "password123" });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("email not verified");
      const sessions = await all(`SELECT * FROM sessions`);
      expect(sessions).toHaveLength(0);
    });

    it("should reject missing fields", async () => {
      const response = await request(app)
        .post("/api/login")
        .set(await authHeaders(app))
        .send({ email: "user@example.com" });

      expect(response.status).toBe(400);
    });

    it("should require a CSRF token", async () => {
      await createTestUser(run, "user@example.com", "password123");

      const response = await request(app)
        .post("/api/login")
        .send({ email: "user@example.com", password: "password123" });

      expect(response.status).toBe(403);
    });

    it("should rate limit login attempts to 5 per window", async () => {
      const headers = await authHeaders(app);
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post("/api/login")
          .set(headers)
          .send({ email: "user@example.com", password: "wrong" });
        expect(res.status).toBe(401);
      }

      const response = await request(app)
        .post("/api/login")
        .set(headers)
        .send({ email: "user@example.com", password: "wrong" });

      expect(response.status).toBe(429);
    });
  });

  describe("POST /api/logout", () => {
    it("should delete only the current session", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const otherSid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/logout")
        .set(await authHeaders(app, sid));

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(findSetCookie(response)).toMatch(/Expires=Thu, 01 Jan 1970/);

      expect(
        await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]),
      ).toBeUndefined();
      expect(
        await get(`SELECT * FROM sessions WHERE sid = ?`, [otherSid]),
      ).toBeDefined();
    });

    it("should succeed without a session", async () => {
      const response = await request(app)
        .post("/api/logout")
        .set(await authHeaders(app));

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });

    it("should require a CSRF token", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/logout")
        .set(sessionCookie(sid));

      expect(response.status).toBe(403);
      expect(
        await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]),
      ).toBeDefined();
    });
  });

  describe("GET /api/me", () => {
    it("should return the current user", async () => {
      const user = await createTestUser(run, "user@example.com");
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .get("/api/me")
        .set(sessionCookie(sid));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: { id: user.id, email: "user@example.com" },
      });
    });

    it("should return 401 without a session", async () => {
      const response = await request(app).get("/api/me");

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("not authenticated");
    });

    it("should return 401 for an unknown session id", async () => {
      const response = await request(app)
        .get("/api/me")
        .set(sessionCookie("does-not-exist"));

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/verify-email", () => {
    async function insertUnverifiedUser(token, expires) {
      await run(
        `INSERT INTO users (email, password, verified, verification_token, verification_expires)
         VALUES (?, ?, 0, ?, ?)`,
        ["user@example.com", "hashed", token, expires],
      );
    }

    it("should verify email with a valid token", async () => {
      await insertUnverifiedUser("valid-token-123", Date.now() + 60_000);

      const response = await request(app)
        .get("/api/verify-email")
        .query({ token: "valid-token-123" });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const user = await get(`SELECT * FROM users WHERE email = ?`, [
        "user@example.com",
      ]);
      expect(user.verified).toBe(1);
      expect(user.verification_token).toBeNull();
    });

    it("should reject an invalid token", async () => {
      const response = await request(app)
        .get("/api/verify-email")
        .query({ token: "invalid-token" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid or expired verification token");
    });

    it("should reject an expired token", async () => {
      await insertUnverifiedUser("expired-token", Date.now() - 1000);

      const response = await request(app)
        .get("/api/verify-email")
        .query({ token: "expired-token" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid or expired verification token");

      const user = await get(`SELECT * FROM users WHERE email = ?`, [
        "user@example.com",
      ]);
      expect(user.verified).toBe(0);
    });

    it("should require a token", async () => {
      const response = await request(app).get("/api/verify-email");

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("verification token required");
    });

    it("should verify a user registered through the API", async () => {
      await request(app)
        .post("/api/register")
        .set(await authHeaders(app))
        .send({
          email: "flow@example.com",
          password: "password123",
          confirmPassword: "password123",
        });
      const [, token] = ctx.sendVerificationEmail.mock.calls[0];

      const verify = await request(app)
        .get("/api/verify-email")
        .query({ token });
      expect(verify.status).toBe(200);

      const login = await request(app)
        .post("/api/login")
        .set(await authHeaders(app))
        .send({ email: "flow@example.com", password: "password123" });
      expect(login.status).toBe(200);
    });
  });

  describe("POST /api/change-password", () => {
    it("should change the password and invalidate all of the user's sessions", async () => {
      const user = await createTestUser(run, "user@example.com", "oldpassword");
      const other = await createTestUser(run, "other@example.com");
      const sid1 = await createTestSession(run, user.id);
      await createTestSession(run, user.id);
      const otherSid = await createTestSession(run, other.id);

      const response = await request(app)
        .post("/api/change-password")
        .set(await authHeaders(app, sid1))
        .send({
          currentPassword: "oldpassword",
          newPassword: "newpassword123",
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const updatedUser = await get(`SELECT * FROM users WHERE id = ?`, [
        user.id,
      ]);
      expect(await bcrypt.compare("newpassword123", updatedUser.password)).toBe(
        true,
      );

      const sessions = await all(`SELECT * FROM sessions WHERE user_id = ?`, [
        user.id,
      ]);
      expect(sessions).toHaveLength(0);
      expect(
        await get(`SELECT * FROM sessions WHERE sid = ?`, [otherSid]),
      ).toBeDefined();
    });

    it("should reject a wrong current password", async () => {
      const user = await createTestUser(
        run,
        "user@example.com",
        "correctpassword",
      );
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/change-password")
        .set(await authHeaders(app, sid))
        .send({ currentPassword: "wrongpassword", newPassword: "newpassword" });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("current password is incorrect");
      expect(
        await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]),
      ).toBeDefined();
    });

    it("should reject a new password shorter than 6 characters", async () => {
      const user = await createTestUser(run, "user@example.com", "oldpassword");
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/change-password")
        .set(await authHeaders(app, sid))
        .send({ currentPassword: "oldpassword", newPassword: "short" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "new password must be at least 6 characters",
      );
    });

    it("should reject missing fields", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/change-password")
        .set(await authHeaders(app, sid))
        .send({ newPassword: "newpassword" });

      expect(response.status).toBe(400);
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post("/api/change-password")
        .set(await authHeaders(app))
        .send({ currentPassword: "old", newPassword: "newpassword123" });

      expect(response.status).toBe(401);
    });
  });
});
