/**
 * Session Management Tests
 * Tests for session expiration, cleanup, and security
 */

import { randomUUID } from "crypto";
import {
  createTestDatabase,
  initTestDatabase,
  createTestUser,
  createTestSession,
  cleanupDatabase,
} from "./helpers.js";

let db;
let run, get, all;

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

describe("Session Management", () => {
  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    run = testDb.run;
    get = testDb.get;
    all = testDb.all;

    await initTestDatabase(run);
  });

  afterEach(async () => {
    await cleanupDatabase(db);
  });

  describe("Session Creation", () => {
    it("should create session with timestamp", async () => {
      const user = await createTestUser(run);
      const before = Date.now();
      const sid = await createTestSession(run, user.id);
      const after = Date.now();

      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);

      expect(session).toBeDefined();
      expect(session.user_id).toBe(user.id);
      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(after);
    });

    it("should allow multiple sessions for same user", async () => {
      const user = await createTestUser(run);
      const sid1 = await createTestSession(run, user.id);
      const sid2 = await createTestSession(run, user.id);

      expect(sid1).not.toBe(sid2);

      const sessions = await all(`SELECT * FROM sessions WHERE user_id = ?`, [
        user.id,
      ]);

      expect(sessions).toHaveLength(2);
    });

    it("should generate unique session IDs", async () => {
      const user = await createTestUser(run);
      const sids = [];

      for (let i = 0; i < 10; i++) {
        const sid = await createTestSession(run, user.id);
        sids.push(sid);
      }

      const uniqueSids = new Set(sids);
      expect(uniqueSids.size).toBe(10);
    });
  });

  describe("Session Expiration", () => {
    it("should identify expired sessions", async () => {
      const user = await createTestUser(run);
      const sid = randomUUID();

      // Create session that expired 1 day ago
      const expiredTime = Date.now() - SESSION_MAX_AGE - 24 * 60 * 60 * 1000;

      await run(
        `INSERT INTO sessions (sid, user_id, createdAt) VALUES (?, ?, ?)`,
        [sid, user.id, expiredTime],
      );

      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      const sessionAge = Date.now() - session.createdAt;

      expect(sessionAge).toBeGreaterThan(SESSION_MAX_AGE);
    });

    it("should identify valid sessions", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      const sessionAge = Date.now() - session.createdAt;

      expect(sessionAge).toBeLessThan(SESSION_MAX_AGE);
    });

    it("should handle edge case at exact expiration time", async () => {
      const user = await createTestUser(run);
      const sid = randomUUID();

      // Create session at exact expiration boundary
      const exactExpirationTime = Date.now() - SESSION_MAX_AGE;

      await run(
        `INSERT INTO sessions (sid, user_id, createdAt) VALUES (?, ?, ?)`,
        [sid, user.id, exactExpirationTime],
      );

      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      const sessionAge = Date.now() - session.createdAt;

      // Should be expired (age >= max age)
      expect(sessionAge).toBeGreaterThanOrEqual(SESSION_MAX_AGE);
    });
  });

  describe("Session Cleanup", () => {
    it("should delete expired sessions", async () => {
      const user = await createTestUser(run);

      // Create expired session
      const expiredSid = randomUUID();
      const expiredTime = Date.now() - SESSION_MAX_AGE - 24 * 60 * 60 * 1000;
      await run(
        `INSERT INTO sessions (sid, user_id, createdAt) VALUES (?, ?, ?)`,
        [expiredSid, user.id, expiredTime],
      );

      // Create valid session
      const validSid = await createTestSession(run, user.id);

      // Run cleanup query
      const result = await run(`DELETE FROM sessions WHERE createdAt < ?`, [
        Date.now() - SESSION_MAX_AGE,
      ]);

      expect(result.changes).toBe(1);

      // Verify expired session deleted
      const expiredSession = await get(`SELECT * FROM sessions WHERE sid = ?`, [
        expiredSid,
      ]);
      expect(expiredSession).toBeUndefined();

      // Verify valid session still exists
      const validSession = await get(`SELECT * FROM sessions WHERE sid = ?`, [
        validSid,
      ]);
      expect(validSession).toBeDefined();
    });

    it("should handle cleanup with no expired sessions", async () => {
      const user = await createTestUser(run);
      await createTestSession(run, user.id);
      await createTestSession(run, user.id);

      const result = await run(`DELETE FROM sessions WHERE createdAt < ?`, [
        Date.now() - SESSION_MAX_AGE,
      ]);

      expect(result.changes).toBe(0);

      const sessions = await all(`SELECT * FROM sessions WHERE user_id = ?`, [
        user.id,
      ]);
      expect(sessions).toHaveLength(2);
    });

    it("should cleanup multiple expired sessions", async () => {
      const user = await createTestUser(run);
      const expiredTime = Date.now() - SESSION_MAX_AGE - 24 * 60 * 60 * 1000;

      // Create 5 expired sessions
      for (let i = 0; i < 5; i++) {
        const sid = randomUUID();
        await run(
          `INSERT INTO sessions (sid, user_id, createdAt) VALUES (?, ?, ?)`,
          [sid, user.id, expiredTime],
        );
      }

      // Create 2 valid sessions
      await createTestSession(run, user.id);
      await createTestSession(run, user.id);

      const result = await run(`DELETE FROM sessions WHERE createdAt < ?`, [
        Date.now() - SESSION_MAX_AGE,
      ]);

      expect(result.changes).toBe(5);

      const remainingSessions = await all(
        `SELECT * FROM sessions WHERE user_id = ?`,
        [user.id],
      );
      expect(remainingSessions).toHaveLength(2);
    });
  });

  describe("Session Security", () => {
    it("should cascade delete sessions when user is deleted", async () => {
      const user = await createTestUser(run);
      const sid1 = await createTestSession(run, user.id);
      const sid2 = await createTestSession(run, user.id);

      // Enable foreign keys for CASCADE
      await run(`PRAGMA foreign_keys = ON`);

      // Delete user
      await run(`DELETE FROM users WHERE id = ?`, [user.id]);

      // Verify sessions were cascade deleted
      const sessions = await all(`SELECT * FROM sessions WHERE user_id = ?`, [
        user.id,
      ]);
      expect(sessions).toHaveLength(0);
    });

    it("should delete all user sessions on password change", async () => {
      const user = await createTestUser(run);

      // Create multiple sessions
      await createTestSession(run, user.id);
      await createTestSession(run, user.id);
      await createTestSession(run, user.id);

      // Simulate password change - delete all sessions
      const result = await run(`DELETE FROM sessions WHERE user_id = ?`, [
        user.id,
      ]);

      expect(result.changes).toBe(3);

      const sessions = await all(`SELECT * FROM sessions WHERE user_id = ?`, [
        user.id,
      ]);
      expect(sessions).toHaveLength(0);
    });

    it("should not affect other users sessions", async () => {
      const user1 = await createTestUser(run, "user1@example.com");
      const user2 = await createTestUser(run, "user2@example.com");

      await createTestSession(run, user1.id);
      await createTestSession(run, user1.id);
      await createTestSession(run, user2.id);

      // Delete user1 sessions
      await run(`DELETE FROM sessions WHERE user_id = ?`, [user1.id]);

      const user1Sessions = await all(
        `SELECT * FROM sessions WHERE user_id = ?`,
        [user1.id],
      );
      expect(user1Sessions).toHaveLength(0);

      const user2Sessions = await all(
        `SELECT * FROM sessions WHERE user_id = ?`,
        [user2.id],
      );
      expect(user2Sessions).toHaveLength(1);
    });
  });

  describe("Session Validation", () => {
    it("should validate session exists", async () => {
      const nonExistentSid = randomUUID();

      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [
        nonExistentSid,
      ]);

      expect(session).toBeUndefined();
    });

    it("should validate user exists for session", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      // Delete user but not session (simulate orphaned session)
      await run(`PRAGMA foreign_keys = OFF`);
      await run(`DELETE FROM users WHERE id = ?`, [user.id]);

      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      expect(session).toBeDefined();

      const userForSession = await get(`SELECT * FROM users WHERE id = ?`, [
        session.user_id,
      ]);
      expect(userForSession).toBeUndefined();
    });

    it("should handle concurrent session access", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      // Simulate multiple concurrent reads
      const promises = Array(10)
        .fill(null)
        .map(() => get(`SELECT * FROM sessions WHERE sid = ?`, [sid]));

      const results = await Promise.all(promises);

      results.forEach((session) => {
        expect(session).toBeDefined();
        expect(session.user_id).toBe(user.id);
      });
    });
  });

  describe("Session Edge Cases", () => {
    it("should handle sessions at time boundaries", async () => {
      const user = await createTestUser(run);

      // Create session at various times
      const times = [
        Date.now(), // Now
        Date.now() - 1000, // 1 second ago
        Date.now() - SESSION_MAX_AGE / 2, // Halfway to expiration
        Date.now() - SESSION_MAX_AGE + 1000, // 1 second before expiration
      ];

      for (const time of times) {
        const sid = randomUUID();
        await run(
          `INSERT INTO sessions (sid, user_id, createdAt) VALUES (?, ?, ?)`,
          [sid, user.id, time],
        );

        const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [
          sid,
        ]);
        const age = Date.now() - session.createdAt;

        expect(age).toBeLessThan(SESSION_MAX_AGE);
      }
    });

    it("should handle null or invalid timestamps gracefully", async () => {
      const user = await createTestUser(run);
      const sid = randomUUID();

      // Try to insert session with very old timestamp (should still work)
      const veryOldTime = 0; // Unix epoch

      await run(
        `INSERT INTO sessions (sid, user_id, createdAt) VALUES (?, ?, ?)`,
        [sid, user.id, veryOldTime],
      );

      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      expect(session).toBeDefined();
      expect(session.createdAt).toBe(veryOldTime);

      // This session should be expired
      const age = Date.now() - session.createdAt;
      expect(age).toBeGreaterThan(SESSION_MAX_AGE);
    });
  });
});
