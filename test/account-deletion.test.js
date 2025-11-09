import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import csrf from "csurf";
import {
  createTestDatabase,
  initTestDatabase,
  createTestUser,
  createTestSession,
  createTestTrip,
  createTestCity,
  extractSessionCookie,
  extractCsrfToken,
  cleanupDatabase,
} from "./helpers.js";

describe("Account Deletion", () => {
  let app;
  let db;
  let run;

  beforeEach(async () => {
    ({ db, run } = await createTestDatabase());
    await initTestDatabase(run);

    app = express();
    app.use(express.json());
    app.use(cookieParser());

    const csrfProtection = csrf({
      cookie: { httpOnly: true, sameSite: "strict" },
    });

    // Mock getSession function
    async function getSession(req) {
      const sid = req.cookies.trippino_sid;
      if (!sid) return null;
      return new Promise((resolve, reject) => {
        db.get(
          `SELECT s.sid, s.user_id, s.createdAt, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.sid = ?`,
          [sid],
          (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            resolve({
              sid: row.sid,
              createdAt: row.createdAt,
              user: { id: row.user_id, email: row.email },
            });
          },
        );
      });
    }

    // CSRF token endpoint
    app.get("/api/csrf-token", csrfProtection, (req, res) => {
      res.json({ csrfToken: req.csrfToken() });
    });

    // Delete account endpoint
    app.delete("/api/me", csrfProtection, async (req, res) => {
      try {
        const s = await getSession(req);
        if (!s) return res.status(401).json({ error: "not authenticated" });

        const userId = s.user.id;

        // Delete user (CASCADE will handle sessions, trips, and cities)
        await run(`DELETE FROM users WHERE id = ?`, [userId]);

        // Clear session cookie
        res.clearCookie("trippino_sid", { httpOnly: true, sameSite: "lax" });

        return res.json({ ok: true, message: "account deleted successfully" });
      } catch (e) {
        console.error("[Account Deletion] Error:", e);
        return res.status(500).json({ error: "server error" });
      }
    });
  });

  afterEach(async () => {
    await cleanupDatabase(db);
  });

  test("should delete user account and all associated data", async () => {
    // Create test user
    const user = await createTestUser(
      run,
      "test@example.com",
      "password123",
      true,
    );
    const userId = user.id;

    // Create session for user
    const sessionId = await createTestSession(run, userId);

    // Create trip and cities for user
    const trip = await createTestTrip(run, userId, "My Trip", "2025-06-01");
    const tripId = trip.id;
    await createTestCity(run, tripId, "Paris", 3, 0);
    await createTestCity(run, tripId, "London", 2, 1);

    // Verify data exists
    const userBefore = await new Promise((resolve) => {
      db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, row) =>
        resolve(row),
      );
    });
    expect(userBefore).toBeTruthy();

    const sessionsBefore = await new Promise((resolve) => {
      db.all(
        `SELECT * FROM sessions WHERE user_id = ?`,
        [userId],
        (err, rows) => resolve(rows),
      );
    });
    expect(sessionsBefore.length).toBe(1);

    const tripsBefore = await new Promise((resolve) => {
      db.all(`SELECT * FROM trips WHERE user_id = ?`, [userId], (err, rows) =>
        resolve(rows),
      );
    });
    expect(tripsBefore.length).toBe(1);

    const citiesBefore = await new Promise((resolve) => {
      db.all(`SELECT * FROM cities WHERE trip_id = ?`, [tripId], (err, rows) =>
        resolve(rows),
      );
    });
    expect(citiesBefore.length).toBe(2);

    // Get CSRF token
    const csrfRes = await request(app)
      .get("/api/csrf-token")
      .set("Cookie", [`trippino_sid=${sessionId}`]);
    const csrfToken = extractCsrfToken(csrfRes);
    const csrfCookie = extractSessionCookie(csrfRes, "_csrf");

    // Delete account
    const cookies = [`trippino_sid=${sessionId}`];
    if (csrfCookie) cookies.push(csrfCookie);

    const deleteRes = await request(app)
      .delete("/api/me")
      .set("Cookie", cookies)
      .set("CSRF-Token", csrfToken);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);
    expect(deleteRes.body.message).toBe("account deleted successfully");

    // Verify user is deleted
    const userAfter = await new Promise((resolve) => {
      db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, row) =>
        resolve(row),
      );
    });
    expect(userAfter).toBeUndefined();

    // Verify sessions are deleted (CASCADE)
    const sessionsAfter = await new Promise((resolve) => {
      db.all(
        `SELECT * FROM sessions WHERE user_id = ?`,
        [userId],
        (err, rows) => resolve(rows),
      );
    });
    expect(sessionsAfter.length).toBe(0);

    // Verify trips are deleted (CASCADE)
    const tripsAfter = await new Promise((resolve) => {
      db.all(`SELECT * FROM trips WHERE user_id = ?`, [userId], (err, rows) =>
        resolve(rows),
      );
    });
    expect(tripsAfter.length).toBe(0);

    // Verify cities are deleted (CASCADE through trips)
    const citiesAfter = await new Promise((resolve) => {
      db.all(`SELECT * FROM cities WHERE trip_id = ?`, [tripId], (err, rows) =>
        resolve(rows),
      );
    });
    expect(citiesAfter.length).toBe(0);
  });

  test("should return 401 when not authenticated", async () => {
    // First get a CSRF token with a valid CSRF cookie
    const csrfRes = await request(app).get("/api/csrf-token");
    const csrfToken = extractCsrfToken(csrfRes);
    const csrfCookie = extractSessionCookie(csrfRes, "_csrf");

    // Try to delete account without session (but with CSRF cookie)
    const res = await request(app)
      .delete("/api/me")
      .set("Cookie", csrfCookie ? [csrfCookie] : [])
      .set("CSRF-Token", csrfToken);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("not authenticated");
  });

  test("should require CSRF token", async () => {
    // Create test user and session
    const user = await createTestUser(
      run,
      "test@example.com",
      "password123",
      true,
    );
    const sessionId = await createTestSession(run, user.id);

    // Try to delete account without CSRF token
    const res = await request(app)
      .delete("/api/me")
      .set("Cookie", [`trippino_sid=${sessionId}`]);

    expect(res.status).toBe(403);
  });

  test("should not affect other users data", async () => {
    // Create two users
    const user1 = await createTestUser(
      run,
      "user1@example.com",
      "password123",
      true,
    );
    const user2 = await createTestUser(
      run,
      "user2@example.com",
      "password123",
      true,
    );
    const user1Id = user1.id;
    const user2Id = user2.id;

    // Create session for user1
    const sessionId = await createTestSession(run, user1Id);

    // Create trips for both users
    const trip1 = await createTestTrip(
      run,
      user1Id,
      "User1 Trip",
      "2025-06-01",
    );
    const trip2 = await createTestTrip(
      run,
      user2Id,
      "User2 Trip",
      "2025-07-01",
    );
    const trip1Id = trip1.id;
    const trip2Id = trip2.id;

    await createTestCity(run, trip1Id, "Paris", 3, 0);
    await createTestCity(run, trip2Id, "London", 2, 0);

    // Get CSRF token
    const csrfRes = await request(app)
      .get("/api/csrf-token")
      .set("Cookie", [`trippino_sid=${sessionId}`]);
    const csrfToken = extractCsrfToken(csrfRes);
    const csrfCookie = extractSessionCookie(csrfRes, "_csrf");

    // Delete user1 account
    const cookies = [`trippino_sid=${sessionId}`];
    if (csrfCookie) cookies.push(csrfCookie);

    const deleteRes = await request(app)
      .delete("/api/me")
      .set("Cookie", cookies)
      .set("CSRF-Token", csrfToken);

    expect(deleteRes.status).toBe(200);

    // Verify user1 is deleted
    const user1After = await new Promise((resolve) => {
      db.get(`SELECT * FROM users WHERE id = ?`, [user1Id], (err, row) =>
        resolve(row),
      );
    });
    expect(user1After).toBeUndefined();

    // Verify user2 still exists
    const user2After = await new Promise((resolve) => {
      db.get(`SELECT * FROM users WHERE id = ?`, [user2Id], (err, row) =>
        resolve(row),
      );
    });
    expect(user2After).toBeTruthy();
    expect(user2After.email).toBe("user2@example.com");

    // Verify user1 trip is deleted
    const trip1After = await new Promise((resolve) => {
      db.get(`SELECT * FROM trips WHERE id = ?`, [trip1Id], (err, row) =>
        resolve(row),
      );
    });
    expect(trip1After).toBeUndefined();

    // Verify user2 trip still exists
    const trip2After = await new Promise((resolve) => {
      db.get(`SELECT * FROM trips WHERE id = ?`, [trip2Id], (err, row) =>
        resolve(row),
      );
    });
    expect(trip2After).toBeTruthy();
    expect(trip2After.name).toBe("User2 Trip");
  });
});
