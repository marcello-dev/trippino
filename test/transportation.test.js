/**
 * Transportation API Tests
 * Tests for setting and removing the travel mode between consecutive cities.
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

describe("Transportation API", () => {
  let ctx;
  let app, run, get, all;
  let user, sid, trip, rome, florence, venice;

  beforeEach(async () => {
    ctx = await createTestContext();
    ({ app, run, get, all } = ctx);
    user = await createTestUser(run);
    sid = await createTestSession(run, user.id);
    trip = await createTestTrip(run, user.id);
    rome = await createTestCity(run, trip.id, "Rome", 2, 0);
    florence = await createTestCity(run, trip.id, "Florence", 2, 1);
    venice = await createTestCity(run, trip.id, "Venice", 2, 2);
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function putLeg(fromCityId, body, tripId = trip.id) {
    return request(app)
      .put(`/api/trips/${tripId}/cities/${fromCityId}/transportation`)
      .set(await authHeaders(app, sid))
      .send(body);
  }

  async function deleteLeg(fromCityId, tripId = trip.id) {
    return request(app)
      .delete(`/api/trips/${tripId}/cities/${fromCityId}/transportation`)
      .set(await authHeaders(app, sid));
  }

  describe("PUT /api/trips/:tripId/cities/:fromCityId/transportation", () => {
    it("should create a leg to the next city", async () => {
      const response = await putLeg(rome.id, {
        toCityId: florence.id,
        mode: "train",
        notes: "  Frecciarossa  ",
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        transportation: {
          id: expect.any(Number),
          trip_id: trip.id,
          from_city_id: rome.id,
          to_city_id: florence.id,
          mode: "train",
          notes: "Frecciarossa",
        },
      });
    });

    it("should update an existing leg instead of creating a new one", async () => {
      const first = await putLeg(rome.id, {
        toCityId: florence.id,
        mode: "car",
      });
      const second = await putLeg(rome.id, {
        toCityId: florence.id,
        mode: "bike",
      });

      expect(second.status).toBe(200);
      expect(second.body.transportation.id).toBe(first.body.transportation.id);
      expect(second.body.transportation.mode).toBe("bike");
      expect(await all(`SELECT * FROM transportation`)).toHaveLength(1);
    });

    it("should only allow the next city as destination", async () => {
      const response = await putLeg(rome.id, {
        toCityId: venice.id,
        mode: "train",
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "transportation can only be set to the next city in the trip",
      );
    });

    it("should reject a leg from the last city", async () => {
      const response = await putLeg(venice.id, {
        toCityId: rome.id,
        mode: "train",
      });

      expect(response.status).toBe(400);
    });

    it("should reject an unknown mode", async () => {
      const response = await putLeg(rome.id, {
        toCityId: florence.id,
        mode: "teleport",
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid mode");
    });

    it("should require a mode", async () => {
      const response = await putLeg(rome.id, { toCityId: florence.id });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("mode is required");
    });

    it("should require a valid destination city id", async () => {
      const response = await putLeg(rome.id, { mode: "train" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid to city id");
    });

    it("should return 404 when the from city is not in the trip", async () => {
      const response = await putLeg(99999, {
        toCityId: florence.id,
        mode: "train",
      });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("from city not found");
    });

    it("should not allow editing another user's trip", async () => {
      const other = await createTestUser(run, "other@example.com");
      const theirTrip = await createTestTrip(run, other.id);
      const a = await createTestCity(run, theirTrip.id, "A", 1, 0);
      const b = await createTestCity(run, theirTrip.id, "B", 1, 1);

      const response = await putLeg(
        a.id,
        { toCityId: b.id, mode: "walk" },
        theirTrip.id,
      );

      expect(response.status).toBe(404);
      expect(await all(`SELECT * FROM transportation`)).toHaveLength(0);
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${rome.id}/transportation`)
        .set(await authHeaders(app))
        .send({ toCityId: florence.id, mode: "train" });

      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/trips/:tripId/cities/:fromCityId/transportation", () => {
    it("should remove the leg to the next city", async () => {
      await createTestTransportation(run, trip.id, rome.id, florence.id);
      const kept = await createTestTransportation(
        run,
        trip.id,
        florence.id,
        venice.id,
      );

      const response = await deleteLeg(rome.id);

      expect(response.status).toBe(200);
      const remaining = await all(`SELECT id FROM transportation`);
      expect(remaining).toEqual([{ id: kept.id }]);
    });

    it("should reject the last city, which has no next leg", async () => {
      const response = await deleteLeg(venice.id);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("no next city for this leg");
    });

    it("should return 404 for a city not in the trip", async () => {
      const response = await deleteLeg(99999);

      expect(response.status).toBe(404);
    });

    it("should not allow deleting another user's leg", async () => {
      const other = await createTestUser(run, "other@example.com");
      const theirTrip = await createTestTrip(run, other.id);
      const a = await createTestCity(run, theirTrip.id, "A", 1, 0);
      const b = await createTestCity(run, theirTrip.id, "B", 1, 1);
      await createTestTransportation(run, theirTrip.id, a.id, b.id);

      const response = await deleteLeg(a.id, theirTrip.id);

      expect(response.status).toBe(404);
      expect(await all(`SELECT * FROM transportation`)).toHaveLength(1);
    });
  });
});
