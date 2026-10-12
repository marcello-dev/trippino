/**
 * State Sync Tests
 * Tests for GET /api/state and POST /api/state/firstlogin.
 */

import request from "supertest";
import {
  createTestContext,
  authHeaders,
  sessionCookie,
  createTestUser,
  createTestSession,
  createTestTrip,
  createTestCity,
  createTestTransportation,
} from "./helpers.js";

describe("State API", () => {
  let ctx;
  let app, run, all;
  let user, sid;

  beforeEach(async () => {
    ctx = await createTestContext();
    ({ app, run, all } = ctx);
    user = await createTestUser(run);
    sid = await createTestSession(run, user.id);
  });

  afterEach(async () => {
    await ctx.close();
  });

  describe("GET /api/state", () => {
    it("should return null state when the user has no trips", async () => {
      const response = await request(app)
        .get("/api/state")
        .set(sessionCookie(sid));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ state: null });
    });

    it("should return the user's trips with cities and transportation", async () => {
      const trip = await createTestTrip(run, user.id, "Italy", "2026-05-01");
      const rome = await createTestCity(run, trip.id, "Rome", 3, 0);
      const florence = await createTestCity(run, trip.id, "Florence", 2, 1);
      await createTestTransportation(run, trip.id, rome.id, florence.id);
      const empty = await createTestTrip(run, user.id, "Empty", null);

      const response = await request(app)
        .get("/api/state")
        .set(sessionCookie(sid));

      expect(response.status).toBe(200);
      const trips = response.body.state.trips;
      expect(trips).toHaveLength(2);

      const italy = trips.find((t) => t.id === trip.id);
      expect(italy.name).toBe("Italy");
      expect(italy.start_date).toBe("2026-05-01");
      expect(
        [...italy.cities]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((c) => c.name),
      ).toEqual(["Rome", "Florence"]);
      expect(italy.transportation).toEqual([
        {
          id: expect.any(Number),
          trip_id: trip.id,
          from_city_id: rome.id,
          to_city_id: florence.id,
          mode: "train",
          notes: null,
        },
      ]);

      const emptyTrip = trips.find((t) => t.id === empty.id);
      expect(emptyTrip.cities).toEqual([]);
      expect(emptyTrip.transportation).toEqual([]);
    });

    it("should not include other users' trips", async () => {
      const other = await createTestUser(run, "other@example.com");
      await createTestTrip(run, other.id, "Theirs");
      await createTestTrip(run, user.id, "Mine");

      const response = await request(app)
        .get("/api/state")
        .set(sessionCookie(sid));

      expect(response.body.state.trips.map((t) => t.name)).toEqual(["Mine"]);
    });

    it("should require authentication", async () => {
      const response = await request(app).get("/api/state");

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/state/firstlogin", () => {
    it("should save local trips and cities to the database", async () => {
      const state = {
        trips: [
          {
            id: "local-1",
            name: "Spain",
            start_date: "2026-03-01",
            cities: [
              { id: "c1", name: "Madrid", nights: 2, notes: "tapas" },
              { id: "c2", name: "Seville", nights: 3 },
            ],
          },
          { id: "local-2", name: "Later", cities: [] },
        ],
      };

      const response = await request(app)
        .post("/api/state/firstlogin")
        .set(await authHeaders(app, sid))
        .send({ state });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const trips = await all(
        `SELECT * FROM trips WHERE user_id = ? ORDER BY id`,
        [user.id],
      );
      expect(trips.map((t) => [t.name, t.start_date])).toEqual([
        ["Spain", "2026-03-01"],
        ["Later", null],
      ]);

      const cities = await all(
        `SELECT name, nights, notes, sort_order FROM cities WHERE trip_id = ? ORDER BY sort_order`,
        [trips[0].id],
      );
      expect(cities).toEqual([
        { name: "Madrid", nights: 2, notes: "tapas", sort_order: 0 },
        { name: "Seville", nights: 3, notes: null, sort_order: 1 },
      ]);
    });

    it("should return the saved state with database ids", async () => {
      const response = await request(app)
        .post("/api/state/firstlogin")
        .set(await authHeaders(app, sid))
        .send({
          state: {
            trips: [
              {
                id: "local-trip",
                name: "Spain",
                cities: [
                  { id: "c1", name: "Madrid", nights: 2 },
                  { id: "c2", name: "Seville", nights: 1 },
                ],
              },
            ],
          },
        });

      expect(response.status).toBe(200);
      const [trip] = response.body.state.trips;
      const dbTrip = await ctx.get(`SELECT id FROM trips WHERE user_id = ?`, [
        user.id,
      ]);
      expect(trip.id).toBe(dbTrip.id);
      for (const city of trip.cities) {
        expect(typeof city.id).toBe("number");
        expect(city.trip_id).toBe(dbTrip.id);
      }
    });

    it("should return an empty state when there are no local trips", async () => {
      const response = await request(app)
        .post("/api/state/firstlogin")
        .set(await authHeaders(app, sid))
        .send({ state: { trips: [] } });

      expect(response.status).toBe(200);
      expect(response.body.state).toEqual({ trips: [] });
    });

    it("should save coordinates and transportation between consecutive cities", async () => {
      const response = await request(app)
        .post("/api/state/firstlogin")
        .set(await authHeaders(app, sid))
        .send({
          state: {
            trips: [
              {
                name: "Italy",
                cities: [
                  { id: "r", name: "Rome", latitude: 41.9, longitude: 12.5 },
                  { id: "f", name: "Florence", latitude: 999, longitude: 11.2 },
                  { id: "v", name: "Venice" },
                ],
                transportation: [
                  { from_city_id: "r", to_city_id: "f", mode: "train" },
                  { from_city_id: "f", to_city_id: "v", mode: "teleport" },
                  { from_city_id: "r", to_city_id: "v", mode: "car" },
                ],
              },
            ],
          },
        });

      expect(response.status).toBe(200);
      const [trip] = response.body.state.trips;
      const byName = Object.fromEntries(trip.cities.map((c) => [c.name, c]));
      expect([byName.Rome.latitude, byName.Rome.longitude]).toEqual([
        41.9, 12.5,
      ]);
      expect([byName.Florence.latitude, byName.Florence.longitude]).toEqual([
        null,
        null,
      ]);

      expect(trip.transportation).toEqual([
        {
          id: expect.any(Number),
          trip_id: trip.id,
          from_city_id: byName.Rome.id,
          to_city_id: byName.Florence.id,
          mode: "train",
          notes: null,
        },
      ]);
    });

    it("should save nothing when any trip is invalid", async () => {
      const response = await request(app)
        .post("/api/state/firstlogin")
        .set(await authHeaders(app, sid))
        .send({
          state: {
            trips: [
              { name: "Valid", cities: [{ name: "Madrid" }] },
              { name: "Broken", cities: [{ name: "" }] },
            ],
          },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("city name required");
      expect(await all(`SELECT * FROM trips`)).toHaveLength(0);
      expect(await all(`SELECT * FROM cities`)).toHaveLength(0);
    });

    it("should make saved trips available from GET /api/state", async () => {
      await request(app)
        .post("/api/state/firstlogin")
        .set(await authHeaders(app, sid))
        .send({
          state: {
            trips: [{ name: "Spain", cities: [{ name: "Madrid", nights: 1 }] }],
          },
        });

      const response = await request(app)
        .get("/api/state")
        .set(sessionCookie(sid));

      expect(response.body.state.trips).toHaveLength(1);
      expect(response.body.state.trips[0].cities[0].name).toBe("Madrid");
    });

    it("should reject a missing state", async () => {
      const response = await request(app)
        .post("/api/state/firstlogin")
        .set(await authHeaders(app, sid))
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("state missing in body");
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post("/api/state/firstlogin")
        .set(await authHeaders(app))
        .send({ state: { trips: [] } });

      expect(response.status).toBe(401);
    });

    it("should require a CSRF token", async () => {
      const response = await request(app)
        .post("/api/state/firstlogin")
        .set(sessionCookie(sid))
        .send({ state: { trips: [{ name: "Spain", cities: [] }] } });

      expect(response.status).toBe(403);
      expect(await all(`SELECT * FROM trips`)).toHaveLength(0);
    });
  });
});
