/**
 * Account Deletion Tests (DELETE /api/me) against the real app
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

describe("Account Deletion", () => {
  let ctx;
  let app, run, get, all;

  beforeEach(async () => {
    ctx = await createTestContext();
    ({ app, run, get, all } = ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  test("should delete the user and all associated data", async () => {
    const user = await createTestUser(run, "test@example.com");
    const sid = await createTestSession(run, user.id);
    await createTestSession(run, user.id);
    const trip = await createTestTrip(run, user.id, "My Trip", "2025-06-01");
    const paris = await createTestCity(run, trip.id, "Paris", 3, 0);
    const london = await createTestCity(run, trip.id, "London", 2, 1);
    await createTestTransportation(run, trip.id, paris.id, london.id);

    const response = await request(app)
      .delete("/api/me")
      .set(await authHeaders(app, sid));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      message: "account deleted successfully",
    });

    expect(
      await get(`SELECT * FROM users WHERE id = ?`, [user.id]),
    ).toBeUndefined();
    expect(
      await all(`SELECT * FROM sessions WHERE user_id = ?`, [user.id]),
    ).toHaveLength(0);
    expect(
      await all(`SELECT * FROM trips WHERE user_id = ?`, [user.id]),
    ).toHaveLength(0);
    expect(
      await all(`SELECT * FROM cities WHERE trip_id = ?`, [trip.id]),
    ).toHaveLength(0);
    expect(
      await all(`SELECT * FROM transportation WHERE trip_id = ?`, [trip.id]),
    ).toHaveLength(0);

    const me = await request(app).get("/api/me").set(sessionCookie(sid));
    expect(me.status).toBe(401);
  });

  test("should return 401 when not authenticated", async () => {
    const response = await request(app)
      .delete("/api/me")
      .set(await authHeaders(app));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("not authenticated");
  });

  test("should require a CSRF token", async () => {
    const user = await createTestUser(run, "test@example.com");
    const sid = await createTestSession(run, user.id);

    const response = await request(app)
      .delete("/api/me")
      .set(sessionCookie(sid));

    expect(response.status).toBe(403);
    expect(
      await get(`SELECT * FROM users WHERE id = ?`, [user.id]),
    ).toBeDefined();
  });

  test("should not affect other users' data", async () => {
    const user1 = await createTestUser(run, "user1@example.com");
    const user2 = await createTestUser(run, "user2@example.com");
    const sid1 = await createTestSession(run, user1.id);
    const sid2 = await createTestSession(run, user2.id);
    const trip1 = await createTestTrip(run, user1.id, "User1 Trip");
    const trip2 = await createTestTrip(run, user2.id, "User2 Trip");
    await createTestCity(run, trip1.id, "Paris");
    const london = await createTestCity(run, trip2.id, "London");

    const response = await request(app)
      .delete("/api/me")
      .set(await authHeaders(app, sid1));
    expect(response.status).toBe(200);

    expect(
      await get(`SELECT * FROM users WHERE id = ?`, [user1.id]),
    ).toBeUndefined();
    expect(
      await get(`SELECT * FROM trips WHERE id = ?`, [trip1.id]),
    ).toBeUndefined();

    expect(
      (await get(`SELECT * FROM users WHERE id = ?`, [user2.id])).email,
    ).toBe("user2@example.com");
    expect(
      (await get(`SELECT * FROM trips WHERE id = ?`, [trip2.id])).name,
    ).toBe("User2 Trip");
    expect(
      await get(`SELECT * FROM cities WHERE id = ?`, [london.id]),
    ).toBeDefined();
    expect(
      await get(`SELECT * FROM sessions WHERE sid = ?`, [sid2]),
    ).toBeDefined();
  });
});
