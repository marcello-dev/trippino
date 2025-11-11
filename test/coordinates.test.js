/**
 * Test for city coordinates functionality
 */

import { describe, test, expect } from "@jest/globals";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import {
  createTestDatabase,
  initTestDatabase,
  createTestUser,
  createTestSession,
  createTestTrip,
  cleanupDatabase,
} from "./helpers.js";

// Import the routes
import registerCityRoutes from "../app/routes/cities.js";
import registerTripRoutes from "../app/routes/trips.js";

let app;
let db;
let run, get, all;

describe("City Coordinates API", () => {
  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    run = testDb.run;
    get = testDb.get;
    all = testDb.all;

    await initTestDatabase(run);

    // Create test app
    app = express();
    app.use(express.json());
    app.use(cookieParser());

    // Mock dependencies
    const csrfProtection = (req, res, next) => next();
    const getSession = async (req) => {
      const sessionId = req.headers.authorization?.replace("Bearer ", "");
      if (!sessionId) return null;
      const session = await get("SELECT * FROM sessions WHERE sid = ?", [
        sessionId,
      ]);
      if (!session) return null;
      const user = await get("SELECT * FROM users WHERE id = ?", [
        session.user_id,
      ]);
      return session ? { user, ...session } : null;
    };

    // Register routes
    registerCityRoutes(app, { csrfProtection, getSession, run, get });
    registerTripRoutes(app, { csrfProtection, getSession, run, get, all });
  });

  afterEach(async () => {
    await cleanupDatabase(db);
  });

  test("should create city with coordinates", async () => {
    // Create test user and trip
    const user = await createTestUser(run);
    const sessionId = await createTestSession(run, user.id);
    const trip = await createTestTrip(run, user.id);

    const cityData = {
      name: "Paris, FR",
      nights: 3,
      notes: "Beautiful city",
      latitude: 48.8566,
      longitude: 2.3522,
    };

    const response = await request(app)
      .post(`/api/trips/${trip.id}/cities`)
      .set("Authorization", `Bearer ${sessionId}`)
      .send(cityData);

    expect(response.status).toBe(201);
    expect(response.body.name).toBe("Paris, FR");
    expect(response.body.nights).toBe(3);
    expect(response.body.notes).toBe("Beautiful city");
    expect(response.body.latitude).toBe(48.8566);
    expect(response.body.longitude).toBe(2.3522);
  });

  test("should create city without coordinates", async () => {
    // Create test user and trip
    const user = await createTestUser(run);
    const sessionId = await createTestSession(run, user.id);
    const trip = await createTestTrip(run, user.id);

    const cityData = {
      name: "Unknown City",
      nights: 2,
    };

    const response = await request(app)
      .post(`/api/trips/${trip.id}/cities`)
      .set("Authorization", `Bearer ${sessionId}`)
      .send(cityData);

    expect(response.status).toBe(201);
    expect(response.body.name).toBe("Unknown City");
    expect(response.body.nights).toBe(2);
    expect(response.body.latitude).toBeNull();
    expect(response.body.longitude).toBeNull();
  });

  test("should update city coordinates", async () => {
    // Create test user and trip
    const user = await createTestUser(run);
    const sessionId = await createTestSession(run, user.id);
    const trip = await createTestTrip(run, user.id);

    // Create city without coordinates
    const createRes = await request(app)
      .post(`/api/trips/${trip.id}/cities`)
      .set("Authorization", `Bearer ${sessionId}`)
      .send({
        name: "Test City",
        nights: 1,
      });

    const cityId = createRes.body.id;

    // Update with coordinates
    const updateRes = await request(app)
      .put(`/api/trips/${trip.id}/cities/${cityId}`)
      .set("Authorization", `Bearer ${sessionId}`)
      .send({
        latitude: 40.7128,
        longitude: -74.006,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.city.latitude).toBe(40.7128);
    expect(updateRes.body.city.longitude).toBe(-74.006);
  });

  test("should validate coordinate ranges", async () => {
    // Create test user and trip
    const user = await createTestUser(run);
    const sessionId = await createTestSession(run, user.id);
    const trip = await createTestTrip(run, user.id);

    // Test invalid latitude
    const invalidLatResponse = await request(app)
      .post(`/api/trips/${trip.id}/cities`)
      .set("Authorization", `Bearer ${sessionId}`)
      .send({
        name: "Invalid City",
        nights: 1,
        latitude: 91, // Invalid: > 90
        longitude: 0,
      });

    expect(invalidLatResponse.status).toBe(400);
    expect(invalidLatResponse.body.error).toContain("latitude");

    // Test invalid longitude
    const invalidLonResponse = await request(app)
      .post(`/api/trips/${trip.id}/cities`)
      .set("Authorization", `Bearer ${sessionId}`)
      .send({
        name: "Invalid City",
        nights: 1,
        latitude: 0,
        longitude: 181, // Invalid: > 180
      });

    expect(invalidLonResponse.status).toBe(400);
    expect(invalidLonResponse.body.error).toContain("longitude");
  });
});
