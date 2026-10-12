/**
 * City coordinates tests against the real app
 */

import request from "supertest";
import {
  createTestContext,
  authHeaders,
  createTestUser,
  createTestSession,
  createTestTrip,
} from "./helpers.js";

describe("City Coordinates API", () => {
  let ctx;
  let app, run;
  let sid, trip;

  beforeEach(async () => {
    ctx = await createTestContext();
    ({ app, run } = ctx);
    const user = await createTestUser(run);
    sid = await createTestSession(run, user.id);
    trip = await createTestTrip(run, user.id);
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function createCity(body) {
    return request(app)
      .post(`/api/trips/${trip.id}/cities`)
      .set(await authHeaders(app, sid))
      .send(body);
  }

  async function updateCity(cityId, body) {
    return request(app)
      .put(`/api/trips/${trip.id}/cities/${cityId}`)
      .set(await authHeaders(app, sid))
      .send(body);
  }

  test("should create city with coordinates", async () => {
    const response = await createCity({
      name: "Paris, FR",
      nights: 3,
      notes: "Beautiful city",
      latitude: 48.8566,
      longitude: 2.3522,
    });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe("Paris, FR");
    expect(response.body.latitude).toBe(48.8566);
    expect(response.body.longitude).toBe(2.3522);
  });

  test("should create city without coordinates", async () => {
    const response = await createCity({ name: "Unknown City", nights: 2 });

    expect(response.status).toBe(201);
    expect(response.body.latitude).toBeNull();
    expect(response.body.longitude).toBeNull();
  });

  test("should update city coordinates", async () => {
    const created = await createCity({ name: "Test City", nights: 1 });

    const response = await updateCity(created.body.id, {
      latitude: 40.7128,
      longitude: -74.006,
    });

    expect(response.status).toBe(200);
    expect(response.body.city.latitude).toBe(40.7128);
    expect(response.body.city.longitude).toBe(-74.006);
  });

  test("should clear city coordinates with null", async () => {
    const created = await createCity({
      name: "Paris",
      latitude: 48.8566,
      longitude: 2.3522,
    });

    const response = await updateCity(created.body.id, {
      latitude: null,
      longitude: null,
    });

    expect(response.status).toBe(200);
    expect(response.body.city.latitude).toBeNull();
    expect(response.body.city.longitude).toBeNull();
  });

  test("should validate coordinate ranges on create", async () => {
    const badLat = await createCity({
      name: "Invalid City",
      latitude: 91,
      longitude: 0,
    });
    expect(badLat.status).toBe(400);
    expect(badLat.body.error).toBe("latitude must be between -90 and 90");

    const badLon = await createCity({
      name: "Invalid City",
      latitude: 0,
      longitude: 181,
    });
    expect(badLon.status).toBe(400);
    expect(badLon.body.error).toBe("longitude must be between -180 and 180");
  });

  test("should require both coordinates to be numbers on create", async () => {
    const onlyLat = await createCity({ name: "Half", latitude: 10 });
    expect(onlyLat.status).toBe(400);
    expect(onlyLat.body.error).toBe("coordinates must be valid numbers");

    const notNumbers = await createCity({
      name: "Text",
      latitude: "north",
      longitude: "east",
    });
    expect(notNumbers.status).toBe(400);
    expect(notNumbers.body.error).toBe("coordinates must be valid numbers");
  });

  test("should validate coordinate ranges on update", async () => {
    const created = await createCity({ name: "Test City" });

    const badLat = await updateCity(created.body.id, { latitude: -91 });
    expect(badLat.status).toBe(400);
    expect(badLat.body.error).toBe("latitude must be between -90 and 90");

    const badLon = await updateCity(created.body.id, { longitude: -181 });
    expect(badLon.status).toBe(400);
    expect(badLon.body.error).toBe("longitude must be between -180 and 180");
  });
});
