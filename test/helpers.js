/**
 * Test Helpers
 * Utility functions for setting up test databases, creating test users, etc.
 */

import sqlite3 from "sqlite3";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { promisify } from "util";

/**
 * Create an in-memory SQLite database for testing
 */
export function createTestDatabase() {
  const db = new sqlite3.Database(":memory:");

  const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        // 'this' context contains lastID and changes
        resolve(this);
      });
    });
  };

  const get = promisify(db.get.bind(db));
  const all = promisify(db.all.bind(db));

  return { db, run, get, all };
}

/**
 * Initialize test database with schema
 */
export async function initTestDatabase(run) {
  await run(`PRAGMA foreign_keys = ON`);

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      verification_token TEXT,
      verification_expires INTEGER
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS states (
      user_id INTEGER PRIMARY KEY,
      state TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS cities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nights INTEGER NOT NULL,
      notes TEXT,
      sort_order INTEGER NOT NULL,
      trip_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    )
  `);
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
export async function createTestSession(run, userId) {
  const sid = randomUUID();
  const createdAt = Date.now();
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
    [name, nights, "", sortOrder, tripId],
  );
  return {
    id: result.lastID,
    name,
    nights,
    notes: "",
    sort_order: sortOrder,
    trip_id: tripId,
  };
}

/**
 * Extract session cookie from response
 */
export function extractSessionCookie(response) {
  const cookies = response.headers["set-cookie"];
  if (!cookies) return null;

  const sessionCookie = cookies.find((c) => c.startsWith("trippino_sid="));
  if (!sessionCookie) return null;

  return sessionCookie.split(";")[0];
}

/**
 * Extract CSRF token from response
 */
export function extractCsrfToken(response) {
  return response.body?.csrfToken || null;
}

/**
 * Clean up database after tests
 */
export async function cleanupDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
