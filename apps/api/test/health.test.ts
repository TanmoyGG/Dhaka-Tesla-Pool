import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("health endpoint", () => {
  it("GET /health returns ok for the api", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        status: "ok",
        service: "dhaka-tesla-pool-api",
      })
    );

    await app.close();
  });

  it("returns a JSON error envelope for unknown routes", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBeDefined();

    await app.close();
  });
});