/**
 * App-level tests: health check, runtime config, static files, security headers
 */

import request from "supertest";
import { createTestContext } from "./helpers.js";

describe("App", () => {
  let ctx;
  let app;

  beforeEach(async () => {
    ctx = await createTestContext();
    ({ app } = ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("should answer the health check", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("should serve the runtime config as JavaScript", async () => {
    const response = await request(app).get("/config.js");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/javascript/);
    expect(response.text).toBe(
      'window.APP_CONFIG = { API_BASE: "http://localhost:5000", TOMTOM_API_KEY: "test-tomtom-key" };',
    );
  });

  it("should serve the frontend", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/html/);
  });

  it("should set security headers", async () => {
    const response = await request(app).get("/api/health");

    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });

  it("should set HSTS in production", async () => {
    const prod = await createTestContext({ isProduction: true });
    try {
      const response = await request(prod.app).get("/api/health");
      expect(response.headers["strict-transport-security"]).toBeDefined();
    } finally {
      await prod.close();
    }
  });

  it("should issue a CSRF token and cookie", async () => {
    const response = await request(app).get("/api/csrf-token");

    expect(response.status).toBe(200);
    expect(typeof response.body.csrfToken).toBe("string");
    expect(response.headers["set-cookie"].join(";")).toMatch(/_csrf=/);
  });
});
