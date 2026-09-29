import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

// loadConfig takes an explicit env so these tests never depend on the ambient
// process environment. The PORT cases exist for platform-injected ports (Render
// sets PORT); API_PORT stays the explicit local/override knob.
describe("loadConfig port resolution", () => {
  it("falls back to PORT when API_PORT is absent", () => {
    expect(loadConfig({ PORT: "8080" }).port).toBe(8080);
  });

  it("prefers an explicit API_PORT over PORT", () => {
    expect(loadConfig({ API_PORT: "3001", PORT: "8080" }).port).toBe(3001);
  });

  it("defaults to 3001 when neither port variable is set", () => {
    expect(loadConfig({}).port).toBe(3001);
  });

  it("treats an empty PORT as absent and keeps the default", () => {
    expect(loadConfig({ PORT: "" }).port).toBe(3001);
  });

  it("rejects an out-of-range PORT rather than silently defaulting", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow(/Invalid port value/);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/Invalid port value/);
  });
});

describe("loadConfig defaults", () => {
  it("keeps the localhost defaults for unset values", () => {
    const config = loadConfig({});

    expect(config.nodeEnv).toBe("development");
    expect(config.host).toBe("0.0.0.0");
    expect(config.webUrl).toBe("http://localhost:3000");
    expect(config.clerkAuthorizedParties).toEqual(["http://localhost:3000"]);
  });

  it("prefers the database URL from the environment", () => {
    const databaseUrl = "postgresql://user:pass@host:5432/dhaka_tesla_pool";

    expect(loadConfig({ DATABASE_URL: databaseUrl }).databaseUrl).toBe(databaseUrl);
  });
});
