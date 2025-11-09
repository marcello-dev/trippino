/**
 * Trip API Tests
 * Tests for trip CRUD operations
 */

import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import {
  createTestDatabase,
  initTestDatabase,
  createTestUser,
  createTestSession,
  createTestTrip,
  createTestCity,
  cleanupDatabase,
} from "./helpers.js";

let app;
let db;
let run, get, all;

describe("Trip API", () => {
  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    run = testDb.run;
    get = testDb.get;
    all = testDb.all;

    await initTestDatabase(run);

    app = express();
    app.use(express.json());
    app.use(cookieParser());

    const COOKIE_NAME = "trippino_sid";

    async function getSession(req) {
      const sid = req.cookies[COOKIE_NAME];
      if (!sid) return null;

      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      if (!session) return null;

      const user = await get(
        `SELECT id, email, verified FROM users WHERE id = ?`,
        [session.user_id],
      );

      return user || null;
    }

    // POST /api/trips - Create trip
    app.post("/api/trips", async (req, res) => {
      try {
        const user = await getSession(req);
        if (!user) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        const { name, start_date } = req.body;

        if (!name || !start_date) {
          return res
            .status(400)
            .json({ error: "Name and start date required" });
        }

        // Validate date format (YYYY-MM-DD)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
          return res.status(400).json({ error: "Invalid date format" });
        }

        const result = await run(
          `INSERT INTO trips (name, start_date, user_id) VALUES (?, ?, ?)`,
          [name, start_date, user.id],
        );

        res.json({ ok: true, id: result.lastID });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // GET /api/trips - List all trips for user
    app.get("/api/trips", async (req, res) => {
      try {
        const user = await getSession(req);
        if (!user) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        const trips = await all(
          `SELECT id, name, start_date, created_at, updated_at 
           FROM trips WHERE user_id = ? ORDER BY start_date ASC`,
          [user.id],
        );

        res.json({ trips });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // GET /api/trips/:id - Get single trip with cities
    app.get("/api/trips/:id", async (req, res) => {
      try {
        const user = await getSession(req);
        if (!user) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        const trip = await get(
          `SELECT * FROM trips WHERE id = ? AND user_id = ?`,
          [req.params.id, user.id],
        );

        if (!trip) {
          return res.status(404).json({ error: "Trip not found" });
        }

        const cities = await all(
          `SELECT * FROM cities WHERE trip_id = ? ORDER BY sort_order ASC`,
          [trip.id],
        );

        res.json({ trip: { ...trip, cities } });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // PUT /api/trips/:id - Update trip
    app.put("/api/trips/:id", async (req, res) => {
      try {
        const user = await getSession(req);
        if (!user) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        const trip = await get(
          `SELECT * FROM trips WHERE id = ? AND user_id = ?`,
          [req.params.id, user.id],
        );

        if (!trip) {
          return res.status(404).json({ error: "Trip not found" });
        }

        const { name, start_date } = req.body;

        if (!name && !start_date) {
          return res.status(400).json({ error: "Nothing to update" });
        }

        if (start_date && !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
          return res.status(400).json({ error: "Invalid date format" });
        }

        const updates = [];
        const params = [];

        if (name) {
          updates.push("name = ?");
          params.push(name);
        }

        if (start_date) {
          updates.push("start_date = ?");
          params.push(start_date);
        }

        updates.push("updated_at = CURRENT_TIMESTAMP");
        params.push(req.params.id, user.id);

        await run(
          `UPDATE trips SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
          params,
        );

        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // DELETE /api/trips/:id - Delete trip
    app.delete("/api/trips/:id", async (req, res) => {
      try {
        const user = await getSession(req);
        if (!user) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        const trip = await get(
          `SELECT * FROM trips WHERE id = ? AND user_id = ?`,
          [req.params.id, user.id],
        );

        if (!trip) {
          return res.status(404).json({ error: "Trip not found" });
        }

        // Enable foreign keys for CASCADE delete
        await run(`PRAGMA foreign_keys = ON`);

        await run(`DELETE FROM trips WHERE id = ? AND user_id = ?`, [
          req.params.id,
          user.id,
        ]);

        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });
  });

  afterEach(async () => {
    await cleanupDatabase(db);
  });

  describe("POST /api/trips", () => {
    it("should create a new trip", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/trips")
        .set("Cookie", `trippino_sid=${sid}`)
        .send({
          name: "Europe Adventure",
          start_date: "2025-12-01",
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.id).toBeDefined();

      // Verify trip was created
      const trip = await get(`SELECT * FROM trips WHERE id = ?`, [
        response.body.id,
      ]);
      expect(trip.name).toBe("Europe Adventure");
      expect(trip.start_date).toBe("2025-12-01");
      expect(trip.user_id).toBe(user.id);
    });

    it("should require authentication", async () => {
      const response = await request(app).post("/api/trips").send({
        name: "Trip",
        start_date: "2025-12-01",
      });

      expect(response.status).toBe(401);
    });

    it("should validate required fields", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/trips")
        .set("Cookie", `trippino_sid=${sid}`)
        .send({ name: "Trip" }); // Missing start_date

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("required");
    });

    it("should validate date format", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .post("/api/trips")
        .set("Cookie", `trippino_sid=${sid}`)
        .send({
          name: "Trip",
          start_date: "12/01/2025", // Invalid format
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid date format");
    });
  });

  describe("GET /api/trips", () => {
    it("should list all trips for user", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      await createTestTrip(run, user.id, "Trip 1", "2025-12-01");
      await createTestTrip(run, user.id, "Trip 2", "2025-12-15");

      const response = await request(app)
        .get("/api/trips")
        .set("Cookie", `trippino_sid=${sid}`);

      expect(response.status).toBe(200);
      expect(response.body.trips).toHaveLength(2);
      expect(response.body.trips[0].name).toBe("Trip 1");
      expect(response.body.trips[1].name).toBe("Trip 2");
    });

    it("should only return trips for authenticated user", async () => {
      const user1 = await createTestUser(run, "user1@example.com");
      const user2 = await createTestUser(run, "user2@example.com");
      const sid1 = await createTestSession(run, user1.id);

      await createTestTrip(run, user1.id, "User 1 Trip");
      await createTestTrip(run, user2.id, "User 2 Trip");

      const response = await request(app)
        .get("/api/trips")
        .set("Cookie", `trippino_sid=${sid1}`);

      expect(response.status).toBe(200);
      expect(response.body.trips).toHaveLength(1);
      expect(response.body.trips[0].name).toBe("User 1 Trip");
    });

    it("should require authentication", async () => {
      const response = await request(app).get("/api/trips");

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/trips/:id", () => {
    it("should get trip with cities", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);

      await createTestCity(run, trip.id, "Paris", 3, 0);
      await createTestCity(run, trip.id, "Rome", 2, 1);

      const response = await request(app)
        .get(`/api/trips/${trip.id}`)
        .set("Cookie", `trippino_sid=${sid}`);

      expect(response.status).toBe(200);
      expect(response.body.trip.name).toBe(trip.name);
      expect(response.body.trip.cities).toHaveLength(2);
      expect(response.body.trip.cities[0].name).toBe("Paris");
      expect(response.body.trip.cities[1].name).toBe("Rome");
    });

    it("should return 404 for non-existent trip", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .get("/api/trips/99999")
        .set("Cookie", `trippino_sid=${sid}`);

      expect(response.status).toBe(404);
    });

    it("should not allow access to other users trips", async () => {
      const user1 = await createTestUser(run, "user1@example.com");
      const user2 = await createTestUser(run, "user2@example.com");
      const sid1 = await createTestSession(run, user1.id);

      const trip = await createTestTrip(run, user2.id);

      const response = await request(app)
        .get(`/api/trips/${trip.id}`)
        .set("Cookie", `trippino_sid=${sid1}`);

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/trips/:id", () => {
    it("should update trip name", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id, "Old Name");

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set("Cookie", `trippino_sid=${sid}`)
        .send({ name: "New Name" });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const updated = await get(`SELECT * FROM trips WHERE id = ?`, [trip.id]);
      expect(updated.name).toBe("New Name");
    });

    it("should update trip start date", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id, "Trip", "2025-12-01");

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set("Cookie", `trippino_sid=${sid}`)
        .send({ start_date: "2025-12-15" });

      expect(response.status).toBe(200);

      const updated = await get(`SELECT * FROM trips WHERE id = ?`, [trip.id]);
      expect(updated.start_date).toBe("2025-12-15");
    });

    it("should update both name and date", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set("Cookie", `trippino_sid=${sid}`)
        .send({
          name: "Updated Trip",
          start_date: "2026-01-01",
        });

      expect(response.status).toBe(200);

      const updated = await get(`SELECT * FROM trips WHERE id = ?`, [trip.id]);
      expect(updated.name).toBe("Updated Trip");
      expect(updated.start_date).toBe("2026-01-01");
    });

    it("should return 404 for non-existent trip", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .put("/api/trips/99999")
        .set("Cookie", `trippino_sid=${sid}`)
        .send({ name: "Updated" });

      expect(response.status).toBe(404);
    });

    it("should not allow updating other users trips", async () => {
      const user1 = await createTestUser(run, "user1@example.com");
      const user2 = await createTestUser(run, "user2@example.com");
      const sid1 = await createTestSession(run, user1.id);

      const trip = await createTestTrip(run, user2.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set("Cookie", `trippino_sid=${sid1}`)
        .send({ name: "Hacked" });

      expect(response.status).toBe(404);
    });

    it("should validate date format", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set("Cookie", `trippino_sid=${sid}`)
        .send({ start_date: "invalid-date" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid date format");
    });
  });

  describe("DELETE /api/trips/:id", () => {
    it("should delete trip and cascade to cities", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);

      await createTestCity(run, trip.id, "City 1");
      await createTestCity(run, trip.id, "City 2");

      const response = await request(app)
        .delete(`/api/trips/${trip.id}`)
        .set("Cookie", `trippino_sid=${sid}`);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      // Verify trip was deleted
      const deletedTrip = await get(`SELECT * FROM trips WHERE id = ?`, [
        trip.id,
      ]);
      expect(deletedTrip).toBeUndefined();

      // Verify cities were cascade deleted
      const cities = await all(`SELECT * FROM cities WHERE trip_id = ?`, [
        trip.id,
      ]);
      expect(cities).toHaveLength(0);
    });

    it("should return 404 for non-existent trip", async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);

      const response = await request(app)
        .delete("/api/trips/99999")
        .set("Cookie", `trippino_sid=${sid}`);

      expect(response.status).toBe(404);
    });

    it("should not allow deleting other users trips", async () => {
      const user1 = await createTestUser(run, "user1@example.com");
      const user2 = await createTestUser(run, "user2@example.com");
      const sid1 = await createTestSession(run, user1.id);

      const trip = await createTestTrip(run, user2.id);

      const response = await request(app)
        .delete(`/api/trips/${trip.id}`)
        .set("Cookie", `trippino_sid=${sid1}`);

      expect(response.status).toBe(404);

      // Verify trip still exists
      const stillExists = await get(`SELECT * FROM trips WHERE id = ?`, [
        trip.id,
      ]);
      expect(stillExists).toBeDefined();
    });

    it("should require authentication", async () => {
      const user = await createTestUser(run);
      const trip = await createTestTrip(run, user.id);

      const response = await request(app).delete(`/api/trips/${trip.id}`);

      expect(response.status).toBe(401);
    });
  });
});
