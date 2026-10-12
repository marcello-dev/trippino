/**
 * Trip API Tests
 * Tests for trip create, update and delete against the real app.
 */

import request from "supertest";
import {
  createTestContext,
  authHeaders,
  createTestUser,
  createTestSession,
  createTestTrip,
  createTestCity,
  createTestTransportation,
} from "./helpers.js";

describe("Trip API", () => {
  let ctx;
  let app, run, get, all;
  let user, sid;

  beforeEach(async () => {
    ctx = await createTestContext();
    ({ app, run, get, all } = ctx);
    user = await createTestUser(run);
    sid = await createTestSession(run, user.id);
  });

  afterEach(async () => {
    await ctx.close();
  });

  describe("POST /api/trips", () => {
    it("should create a new trip", async () => {
      const response = await request(app)
        .post("/api/trips")
        .set(await authHeaders(app, sid))
        .send({ name: "  Europe Adventure  ", start_date: "2025-12-01" });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.id).toBeDefined();

      const trip = await get(`SELECT * FROM trips WHERE id = ?`, [
        response.body.id,
      ]);
      expect(trip.name).toBe("Europe Adventure");
      expect(trip.start_date).toBe("2025-12-01");
      expect(trip.user_id).toBe(user.id);
    });

    it("should allow a trip without a start date", async () => {
      const response = await request(app)
        .post("/api/trips")
        .set(await authHeaders(app, sid))
        .send({ name: "Someday" });

      expect(response.status).toBe(200);
      const trip = await get(`SELECT * FROM trips WHERE id = ?`, [
        response.body.id,
      ]);
      expect(trip.start_date).toBeNull();
    });

    it("should require a name", async () => {
      const response = await request(app)
        .post("/api/trips")
        .set(await authHeaders(app, sid))
        .send({ name: "   ", start_date: "2025-12-01" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("trip name required");
    });

    it("should validate the date format", async () => {
      const response = await request(app)
        .post("/api/trips")
        .set(await authHeaders(app, sid))
        .send({ name: "Trip", start_date: "12/01/2025" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "start_date must be in YYYY-MM-DD format",
      );
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post("/api/trips")
        .set(await authHeaders(app))
        .send({ name: "Trip", start_date: "2025-12-01" });

      expect(response.status).toBe(401);
    });

    it("should require a CSRF token", async () => {
      const response = await request(app)
        .post("/api/trips")
        .set("Cookie", `trippino_sid=${sid}`)
        .send({ name: "Trip" });

      expect(response.status).toBe(403);
      expect(await all(`SELECT * FROM trips`)).toHaveLength(0);
    });
  });

  describe("PUT /api/trips/:id", () => {
    it("should update the trip name", async () => {
      const trip = await createTestTrip(run, user.id, "Old Name");

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set(await authHeaders(app, sid))
        .send({ name: "New Name" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        trip: { id: trip.id, name: "New Name", start_date: "2025-12-01" },
      });
    });

    it("should update the start date", async () => {
      const trip = await createTestTrip(run, user.id, "Trip", "2025-12-01");

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set(await authHeaders(app, sid))
        .send({ start_date: "2025-12-15" });

      expect(response.status).toBe(200);
      const updated = await get(`SELECT * FROM trips WHERE id = ?`, [trip.id]);
      expect(updated.start_date).toBe("2025-12-15");
      expect(updated.name).toBe("Trip");
    });

    it("should update both name and date", async () => {
      const trip = await createTestTrip(run, user.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set(await authHeaders(app, sid))
        .send({ name: "Updated Trip", start_date: "2026-01-01" });

      expect(response.status).toBe(200);
      const updated = await get(`SELECT * FROM trips WHERE id = ?`, [trip.id]);
      expect(updated.name).toBe("Updated Trip");
      expect(updated.start_date).toBe("2026-01-01");
    });

    it("should clear the start date when given an empty string", async () => {
      const trip = await createTestTrip(run, user.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set(await authHeaders(app, sid))
        .send({ start_date: "" });

      expect(response.status).toBe(200);
      expect(response.body.trip.start_date).toBeNull();
    });

    it("should reject a request with no fields", async () => {
      const trip = await createTestTrip(run, user.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set(await authHeaders(app, sid))
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("no fields to update");
    });

    it("should reject an empty name", async () => {
      const trip = await createTestTrip(run, user.id, "Keep Me");

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set(await authHeaders(app, sid))
        .send({ name: "" });

      expect(response.status).toBe(400);
      const unchanged = await get(`SELECT * FROM trips WHERE id = ?`, [
        trip.id,
      ]);
      expect(unchanged.name).toBe("Keep Me");
    });

    it("should validate the date format", async () => {
      const trip = await createTestTrip(run, user.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set(await authHeaders(app, sid))
        .send({ start_date: "invalid-date" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "start_date must be in YYYY-MM-DD format",
      );
    });

    it("should reject a non-numeric trip id", async () => {
      const response = await request(app)
        .put(`/api/trips/abc`)
        .set(await authHeaders(app, sid))
        .send({ name: "Updated" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid trip id");
    });

    it("should return 404 for a non-existent trip", async () => {
      const response = await request(app)
        .put("/api/trips/99999")
        .set(await authHeaders(app, sid))
        .send({ name: "Updated" });

      expect(response.status).toBe(404);
    });

    it("should not allow updating another user's trip", async () => {
      const other = await createTestUser(run, "other@example.com");
      const trip = await createTestTrip(run, other.id, "Theirs");

      const response = await request(app)
        .put(`/api/trips/${trip.id}`)
        .set(await authHeaders(app, sid))
        .send({ name: "Hacked" });

      expect(response.status).toBe(404);
      const unchanged = await get(`SELECT * FROM trips WHERE id = ?`, [
        trip.id,
      ]);
      expect(unchanged.name).toBe("Theirs");
    });
  });

  describe("DELETE /api/trips/:id", () => {
    it("should delete the trip and cascade to cities and transportation", async () => {
      const trip = await createTestTrip(run, user.id);
      const c1 = await createTestCity(run, trip.id, "City 1", 2, 0);
      const c2 = await createTestCity(run, trip.id, "City 2", 2, 1);
      await createTestTransportation(run, trip.id, c1.id, c2.id);

      const response = await request(app)
        .delete(`/api/trips/${trip.id}`)
        .set(await authHeaders(app, sid));

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      expect(
        await get(`SELECT * FROM trips WHERE id = ?`, [trip.id]),
      ).toBeUndefined();
      expect(
        await all(`SELECT * FROM cities WHERE trip_id = ?`, [trip.id]),
      ).toHaveLength(0);
      expect(
        await all(`SELECT * FROM transportation WHERE trip_id = ?`, [trip.id]),
      ).toHaveLength(0);
    });

    it("should return 404 for a non-existent trip", async () => {
      const response = await request(app)
        .delete("/api/trips/99999")
        .set(await authHeaders(app, sid));

      expect(response.status).toBe(404);
    });

    it("should not allow deleting another user's trip", async () => {
      const other = await createTestUser(run, "other@example.com");
      const trip = await createTestTrip(run, other.id);

      const response = await request(app)
        .delete(`/api/trips/${trip.id}`)
        .set(await authHeaders(app, sid));

      expect(response.status).toBe(404);
      expect(
        await get(`SELECT * FROM trips WHERE id = ?`, [trip.id]),
      ).toBeDefined();
    });

    it("should require authentication", async () => {
      const trip = await createTestTrip(run, user.id);

      const response = await request(app)
        .delete(`/api/trips/${trip.id}`)
        .set(await authHeaders(app));

      expect(response.status).toBe(401);
      expect(
        await get(`SELECT * FROM trips WHERE id = ?`, [trip.id]),
      ).toBeDefined();
    });
  });
});
