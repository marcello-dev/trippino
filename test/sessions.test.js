/**
 * Session Management Tests
 * Tests for session expiration, cleanup and isolation against the real app.
 */

import request from "supertest";
import { deleteExpiredSessions, SESSION_MAX_AGE } from "../app/server.js";
import {
  createTestContext,
  authHeaders,
  sessionCookie,
  createTestUser,
  createTestSession,
  extractCookie,
} from "./helpers.js";

describe("Session Management", () => {
  let ctx;
  let app, run, get, all;

  beforeEach(async () => {
    ctx = await createTestContext();
    ({ app, run, get, all } = ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function login(email, password) {
    const res = await request(app)
      .post("/api/login")
      .set(await authHeaders(app))
      .send({ email, password });
    return extractCookie(res).split("=")[1];
  }

  describe("Session creation", () => {
    it("should store a timestamped session on login", async () => {
      const user = await createTestUser(run, "user@example.com", "password123");
      const before = Date.now();
      const sid = await login("user@example.com", "password123");
      const after = Date.now();

      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      expect(session.user_id).toBe(user.id);
      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(after);
    });

    it("should create a distinct session for each login", async () => {
      const user = await createTestUser(run, "user@example.com", "password123");
      const sid1 = await login("user@example.com", "password123");
      const sid2 = await login("user@example.com", "password123");

      expect(sid1).not.toBe(sid2);
      const sessions = await all(`SELECT * FROM sessions WHERE user_id = ?`, [
        user.id,
      ]);
      expect(sessions).toHaveLength(2);
    });
  });

  describe("Session expiration", () => {
    it("should accept a session just under the max age", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(
        run,
        user.id,
        Date.now() - SESSION_MAX_AGE + 60_000,
      );

      const response = await request(app)
        .get("/api/me")
        .set(sessionCookie(sid));

      expect(response.status).toBe(200);
    });

    it("should reject and delete an expired session", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(
        run,
        user.id,
        Date.now() - SESSION_MAX_AGE - 1000,
      );

      const response = await request(app)
        .get("/api/me")
        .set(sessionCookie(sid));

      expect(response.status).toBe(401);
      expect(
        await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]),
      ).toBeUndefined();
    });

    it("should reject an expired session on protected writes", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id, 0);

      const response = await request(app)
        .post("/api/trips")
        .set(await authHeaders(app, sid))
        .send({ name: "Trip" });

      expect(response.status).toBe(401);
      expect(await all(`SELECT * FROM trips`)).toHaveLength(0);
    });

    it("should delete sessions when their user is deleted", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      await run(`DELETE FROM users WHERE id = ?`, [user.id]);

      expect(
        await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]),
      ).toBeUndefined();
      const response = await request(app)
        .get("/api/me")
        .set(sessionCookie(sid));

      expect(response.status).toBe(401);
    });
  });

  describe("deleteExpiredSessions", () => {
    it("should delete only expired sessions", async () => {
      const user = await createTestUser(run);
      const now = Date.now();
      const expired = [];
      for (let i = 0; i < 3; i++) {
        expired.push(
          await createTestSession(run, user.id, now - SESSION_MAX_AGE - 1000),
        );
      }
      const valid1 = await createTestSession(run, user.id, now);
      const valid2 = await createTestSession(
        run,
        user.id,
        now - SESSION_MAX_AGE + 1000,
      );

      const deleted = await deleteExpiredSessions(run, now);

      expect(deleted).toBe(3);
      const remaining = await all(`SELECT sid FROM sessions`);
      expect(remaining.map((s) => s.sid).sort()).toEqual(
        [valid1, valid2].sort(),
      );
    });

    it("should return 0 when nothing has expired", async () => {
      const user = await createTestUser(run);
      await createTestSession(run, user.id);
      await createTestSession(run, user.id);

      expect(await deleteExpiredSessions(run)).toBe(0);
      expect(await all(`SELECT * FROM sessions`)).toHaveLength(2);
    });
  });
});
