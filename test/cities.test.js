/**
 * City API Tests
 * Tests for city CRUD operations and sort order management against the real app.
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

describe("City API", () => {
  let ctx;
  let app, run, get;
  let user, sid, trip;

  beforeEach(async () => {
    ctx = await createTestContext();
    ({ app, run, get } = ctx);
    user = await createTestUser(run);
    sid = await createTestSession(run, user.id);
    trip = await createTestTrip(run, user.id);
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function otherUsersTrip() {
    const other = await createTestUser(run, "other@example.com");
    return createTestTrip(run, other.id);
  }

  describe("POST /api/trips/:id/cities", () => {
    it("should create a city appended at the end", async () => {
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ name: " Paris ", nights: 3, notes: "Visit Eiffel Tower" });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(Number),
        name: "Paris",
        nights: 3,
        notes: "Visit Eiffel Tower",
        latitude: null,
        longitude: null,
        sort_order: 0,
        trip_id: trip.id,
      });
    });

    it("should increment sort order for each new city", async () => {
      const res1 = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ name: "City 1", nights: 2 });
      const res2 = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ name: "City 2", nights: 3 });

      expect(res1.body.sort_order).toBe(0);
      expect(res2.body.sort_order).toBe(1);
    });

    it("should default nights to 1", async () => {
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ name: "City" });

      expect(response.status).toBe(201);
      expect(response.body.nights).toBe(1);
    });

    it("should allow zero nights (stepover)", async () => {
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ name: "City", nights: 0 });

      expect(response.status).toBe(201);
      expect(response.body.nights).toBe(0);
    });

    it("should store blank notes as null", async () => {
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ name: "City", notes: "   " });

      expect(response.status).toBe(201);
      expect(response.body.notes).toBeNull();
    });

    it("should reject negative nights", async () => {
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ name: "City", nights: -1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("nights must be a non-negative number");
    });

    it("should require a name", async () => {
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ nights: 2 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("city name required");
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app))
        .send({ name: "City", nights: 2 });

      expect(response.status).toBe(401);
    });

    it("should require a CSRF token", async () => {
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set("Cookie", `trippino_sid=${sid}`)
        .send({ name: "City", nights: 2 });

      expect(response.status).toBe(403);
    });

    it("should not allow adding to another user's trip", async () => {
      const theirs = await otherUsersTrip();

      const response = await request(app)
        .post(`/api/trips/${theirs.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ name: "City", nights: 2 });

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/trips/:tripId/cities/:cityId", () => {
    it("should update the city name", async () => {
      const city = await createTestCity(run, trip.id, "Old Name");

      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid))
        .send({ name: "New Name" });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.city.name).toBe("New Name");
    });

    it("should update nights", async () => {
      const city = await createTestCity(run, trip.id, "City", 2);

      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid))
        .send({ nights: 5 });

      expect(response.status).toBe(200);
      const updated = await get(`SELECT * FROM cities WHERE id = ?`, [city.id]);
      expect(updated.nights).toBe(5);
    });

    it("should update and clear notes", async () => {
      const city = await createTestCity(run, trip.id);

      await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid))
        .send({ notes: "Updated notes" });
      expect(
        (await get(`SELECT * FROM cities WHERE id = ?`, [city.id])).notes,
      ).toBe("Updated notes");

      await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid))
        .send({ notes: "" });
      expect(
        (await get(`SELECT * FROM cities WHERE id = ?`, [city.id])).notes,
      ).toBeNull();
    });

    it("should update multiple fields at once", async () => {
      const city = await createTestCity(run, trip.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid))
        .send({ name: "Updated City", nights: 7, notes: "New notes" });

      expect(response.status).toBe(200);
      const updated = await get(`SELECT * FROM cities WHERE id = ?`, [city.id]);
      expect(updated.name).toBe("Updated City");
      expect(updated.nights).toBe(7);
      expect(updated.notes).toBe("New notes");
    });

    it("should reject a request with no fields", async () => {
      const city = await createTestCity(run, trip.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid))
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("no fields to update");
    });

    it("should reject negative nights", async () => {
      const city = await createTestCity(run, trip.id, "City", 2);

      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid))
        .send({ nights: -3 });

      expect(response.status).toBe(400);
      expect(
        (await get(`SELECT * FROM cities WHERE id = ?`, [city.id])).nights,
      ).toBe(2);
    });

    it("should return 404 for a non-existent city", async () => {
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/99999`)
        .set(await authHeaders(app, sid))
        .send({ name: "Updated" });

      expect(response.status).toBe(404);
    });

    it("should return 404 for a city in a different trip", async () => {
      const otherTrip = await createTestTrip(run, user.id, "Other");
      const city = await createTestCity(run, otherTrip.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid))
        .send({ name: "Moved?" });

      expect(response.status).toBe(404);
    });

    it("should not allow updating another user's city", async () => {
      const theirs = await otherUsersTrip();
      const city = await createTestCity(run, theirs.id, "Theirs");

      const response = await request(app)
        .put(`/api/trips/${theirs.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid))
        .send({ name: "Hacked" });

      expect(response.status).toBe(404);
      expect(
        (await get(`SELECT * FROM cities WHERE id = ?`, [city.id])).name,
      ).toBe("Theirs");
    });
  });

  describe("PUT /api/trips/:tripId/cities (reorder)", () => {
    it("should update the sort order of the given cities", async () => {
      const city1 = await createTestCity(run, trip.id, "City 1", 2, 0);
      const city2 = await createTestCity(run, trip.id, "City 2", 3, 1);
      const city3 = await createTestCity(run, trip.id, "City 3", 1, 2);

      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({
          sortOrder: [
            { id: city3.id, index: 0 },
            { id: city2.id, index: 1 },
            { id: city1.id, index: 2 },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const order = await ctx.all(
        `SELECT name FROM cities WHERE trip_id = ? ORDER BY sort_order`,
        [trip.id],
      );
      expect(order.map((c) => c.name)).toEqual(["City 3", "City 2", "City 1"]);
    });

    it("should reject a city from another trip", async () => {
      const otherTrip = await createTestTrip(run, user.id, "Other");
      const city1 = await createTestCity(run, trip.id);
      const city2 = await createTestCity(run, otherTrip.id);

      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({
          sortOrder: [
            { id: city1.id, index: 1 },
            { id: city2.id, index: 0 },
          ],
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("city not found or unauthorized");
      expect(
        (await get(`SELECT * FROM cities WHERE id = ?`, [city2.id])).sort_order,
      ).toBe(0);
    });

    it("should reject a non-array sortOrder", async () => {
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ sortOrder: "nope" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid sortOrder format");
    });

    it("should reject an invalid city id", async () => {
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ sortOrder: [{ id: "abc", index: 0 }] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid city id");
    });

    it("should not allow reordering another user's trip", async () => {
      const theirs = await otherUsersTrip();
      const city = await createTestCity(run, theirs.id);

      const response = await request(app)
        .put(`/api/trips/${theirs.id}/cities`)
        .set(await authHeaders(app, sid))
        .send({ sortOrder: [{ id: city.id, index: 5 }] });

      expect(response.status).toBe(404);
      expect(
        (await get(`SELECT * FROM cities WHERE id = ?`, [city.id])).sort_order,
      ).toBe(0);
    });
  });

  describe("DELETE /api/trips/:id/cities/:cityId", () => {
    it("should delete the city", async () => {
      const city = await createTestCity(run, trip.id);

      const response = await request(app)
        .delete(`/api/trips/${trip.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid));

      expect(response.status).toBe(200);
      expect(
        await get(`SELECT * FROM cities WHERE id = ?`, [city.id]),
      ).toBeUndefined();
    });

    it("should delete transportation legs to and from the city", async () => {
      const a = await createTestCity(run, trip.id, "A", 1, 0);
      const b = await createTestCity(run, trip.id, "B", 1, 1);
      const c = await createTestCity(run, trip.id, "C", 1, 2);
      await createTestTransportation(run, trip.id, a.id, b.id);
      await createTestTransportation(run, trip.id, b.id, c.id);

      const response = await request(app)
        .delete(`/api/trips/${trip.id}/cities/${b.id}`)
        .set(await authHeaders(app, sid));

      expect(response.status).toBe(200);
      expect(
        await ctx.all(`SELECT * FROM transportation WHERE trip_id = ?`, [
          trip.id,
        ]),
      ).toHaveLength(0);
    });

    it("should return 404 for a non-existent city", async () => {
      const response = await request(app)
        .delete(`/api/trips/${trip.id}/cities/99999`)
        .set(await authHeaders(app, sid));

      expect(response.status).toBe(404);
    });

    it("should not allow deleting another user's city", async () => {
      const theirs = await otherUsersTrip();
      const city = await createTestCity(run, theirs.id);

      const response = await request(app)
        .delete(`/api/trips/${theirs.id}/cities/${city.id}`)
        .set(await authHeaders(app, sid));

      expect(response.status).toBe(404);
      expect(
        await get(`SELECT * FROM cities WHERE id = ?`, [city.id]),
      ).toBeDefined();
    });

    it("should require authentication", async () => {
      const city = await createTestCity(run, trip.id);

      const response = await request(app)
        .delete(`/api/trips/${trip.id}/cities/${city.id}`)
        .set(await authHeaders(app));

      expect(response.status).toBe(401);
    });
  });
});
