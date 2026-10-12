/**
 * Test Helpers
 * Builds the real Express app (app/server.js) on an in-memory SQLite database
 * with the production schema and migrations, plus fixtures for seeding data.
 */

import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { jest } from "@jest/globals";
import { openDatabase, initSchema } from "../app/db.js";
import { createApp } from "../app/server.js";
import { runMigrations } from "../migrate.js";

export const COOKIE_NAME = "trippino_sid";

/**
 * Create the real app backed by a fresh in-memory database.
 * Returns the app, db helpers, the mocked email sender and a close() function.
 */
export async function createTestContext(configOverrides = {}) {
  const database = openDatabase(":memory:");
  await initSchema(database.run);
  await runMigrations(database.db);

  const sendVerificationEmail = jest.fn().mockResolvedValue(undefined);
  const app = createApp({
    run: database.run,
    get: database.get,
    all: database.all,
    transaction: database.transaction,
    sendVerificationEmail,
    config: {
      apiBase: "http://localhost:5000",
      tomtomApiKey: "test-tomtom-key",
      isProduction: false,
      skipEmailSending: false,
      ...configOverrides,
    },
  });

  return {
    app,
    run: database.run,
    get: database.get,
    all: database.all,
    transaction: database.transaction,
    sendVerificationEmail,
    close: database.close,
  };
}

/**
 * Fetch a CSRF token and return the headers needed for a state-changing
 * request, optionally authenticated with a session id.
 */
export async function authHeaders(app, sid) {
  const res = await request(app).get("/api/csrf-token");
  const cookies = [extractCookie(res, "_csrf")];
  if (sid) cookies.push(`${COOKIE_NAME}=${sid}`);
  return { Cookie: cookies.join("; "), "CSRF-Token": res.body.csrfToken };
}

/**
 * Headers for an authenticated request that does not need CSRF (GET).
 */
export function sessionCookie(sid) {
  return { Cookie: `${COOKIE_NAME}=${sid}` };
}

/**
 * Create a test user and return user data
 */
export async function createTestUser(
  run,
  email = "test@example.com",
  password = "password123",
  verified = 1,
) {
  const hashedPassword = await bcrypt.hash(password, 10);
  const result = await run(
    `INSERT INTO users (email, password, verified) VALUES (?, ?, ?)`,
    [email, hashedPassword, verified],
  );

  return {
    id: result.lastID,
    email,
    password, // Return plain password for login tests
    verified,
  };
}

/**
 * Create a test session for a user
 */
export async function createTestSession(run, userId, createdAt = Date.now()) {
  const sid = randomUUID();
  await run(`INSERT INTO sessions (sid, user_id, createdAt) VALUES (?, ?, ?)`, [
    sid,
    userId,
    createdAt,
  ]);
  return sid;
}

/**
 * Create a test trip
 */
export async function createTestTrip(
  run,
  userId,
  name = "Test Trip",
  startDate = "2025-12-01",
) {
  const result = await run(
    `INSERT INTO trips (name, start_date, user_id) VALUES (?, ?, ?)`,
    [name, startDate, userId],
  );
  return {
    id: result.lastID,
    name,
    start_date: startDate,
    user_id: userId,
  };
}

/**
 * Create a test city in a trip
 */
export async function createTestCity(
  run,
  tripId,
  name = "Test City",
  nights = 2,
  sortOrder = 0,
) {
  const result = await run(
    `INSERT INTO cities (name, nights, notes, sort_order, trip_id) VALUES (?, ?, ?, ?, ?)`,
    [name, nights, null, sortOrder, tripId],
  );
  return {
    id: result.lastID,
    name,
    nights,
    notes: null,
    sort_order: sortOrder,
    trip_id: tripId,
  };
}

/**
 * Create a transportation leg between two cities
 */
export async function createTestTransportation(
  run,
  tripId,
  fromCityId,
  toCityId,
  mode = "train",
) {
  const result = await run(
    `INSERT INTO transportation (trip_id, from_city_id, to_city_id, mode) VALUES (?, ?, ?, ?)`,
    [tripId, fromCityId, toCityId, mode],
  );
  return { id: result.lastID };
}

/**
 * Extract a "name=value" cookie pair from a response's Set-Cookie headers
 */
export function extractCookie(response, cookieName = COOKIE_NAME) {
  const cookies = response.headers["set-cookie"];
  if (!cookies) return null;

  const cookie = cookies.find((c) => c.startsWith(`${cookieName}=`));
  if (!cookie) return null;

  return cookie.split(";")[0];
}

/**
 * Full Set-Cookie header (with attributes) for a cookie name
 */
export function findSetCookie(response, cookieName = COOKIE_NAME) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((c) => c.startsWith(`${cookieName}=`)) || null;
}
