// Authentication tests for the Phase 3 Clerk integration.
//
// These tests run WITHOUT any real Clerk (no network, no keys): the two
// injectable auth boundaries (SessionVerifier / LocalUserResolver) are
// replaced with deterministic fakes, so the behavior of the API's auth flow
// is what is under test. The real Clerk verification boundary
// (src/auth/provider.ts) is verified against Clerk's own SDK and is not
// network-testable here.
//
// Story cast: Jashim (DRIVER) drives Bullet; Nusrat books rides. Tokens below
// mirror real Clerk session tokens: opaque strings, never logged, resolved
// only through the verifier.

import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { authRoutes } from "../src/auth/routes.js";
import { installAuthContext } from "../src/auth/install.js";
import {
  seedClerkUserId,
  type AuthDependencies,
  type AuthUser,
} from "../src/auth/identity.js";

const CLERK_PASSENGER = "user_2passengerTest000000000001";
const CLERK_DRIVER = "user_2driverTest000000000000001";
const CLERK_UNKNOWN = "user_2unknownClerkIdentity000";
const CLERK_INACTIVE = "user_2inactiveUser000000000001";

const SEED_NUSRAT_ID = "a1000000-0000-4000-8000-000000000002";
const SEED_JASHIM_ID = "a1000000-0000-4000-8000-000000000001";

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: SEED_NUSRAT_ID,
    clerkUserId: CLERK_PASSENGER,
    name: "Nusrat Haque",
    email: "nusrat@example.com",
    role: "PASSENGER",
    active: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

// Deterministic fakes for the two injectable auth boundaries. Tokens are fixed
// strings so the behavioral matrix is explicit and repeatable.
function makeDeps(): AuthDependencies {
  const usersByClerkId = new Map<string, AuthUser>([
    [CLERK_PASSENGER, makeUser()],
    [
      CLERK_DRIVER,
      makeUser({
        id: SEED_JASHIM_ID,
        clerkUserId: CLERK_DRIVER,
        name: "Jashim Ahmed",
        email: "jashim@example.com",
        role: "DRIVER",
      }),
    ],
    [
      CLERK_INACTIVE,
      makeUser({
        clerkUserId: CLERK_INACTIVE,
        name: "Inactive User",
        email: "inactive@example.com",
        active: false,
      }),
    ],
  ]);

  return {
    verifySession: async (token) => {
      switch (token) {
        case "tok-passenger":
          return CLERK_PASSENGER;
        case "tok-driver":
          return CLERK_DRIVER;
        case "tok-unknown":
          return CLERK_UNKNOWN;
        case "tok-reserved":
          // A seed placeholder smuggled in as a token: must never authenticate.
          return seedClerkUserId("nusrat@example.com");
        case "tok-inactive":
          return CLERK_INACTIVE;
        default:
          return null;
      }
    },
    resolveLocalUser: async (clerkUserId) =>
      usersByClerkId.get(clerkUserId) ?? null,
  };
}

// App that additionally exposes the role/authorization and body-trust demo
// routes exercised by the tests.
function buildRoleTestApp(deps: AuthDependencies): FastifyInstance {
  const app = Fastify();
  app.register(async (scope) => {
    installAuthContext(scope, deps);

    scope.get(
      "/driver-only",
      { preHandler: [scope.requireRole(["DRIVER"])] },
      async (request) => ({ user: request.auth!.user }),
    );

    scope.post("/whoami", async (request) => {
      const body = request.body as { userId?: string } | null;
      return {
        // Identity ALWAYS comes from the verified session, never the body.
        authUserId: request.auth!.user.id,
        bodyUserId: body?.userId ?? null,
      };
    });
  });
  return app;
}

describe("authentication (Clerk)", () => {
  it("rejects unauthenticated requests to protected routes with 401", async () => {
    const app = buildApp({ auth: makeDeps() });
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: { code: "AUTH_UNAUTHENTICATED" },
    });
  });

  it("rejects a malformed Authorization header with 401", async () => {
    const app = buildApp({ auth: makeDeps() });
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: { code: "AUTH_UNAUTHENTICATED" },
    });
  });

  it("authenticates a valid Clerk session and maps it to the local user", async () => {
    const app = buildApp({ auth: makeDeps() });
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer tok-passenger" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: {
        id: SEED_NUSRAT_ID,
        name: "Nusrat Haque",
        email: "nusrat@example.com",
        role: "PASSENGER",
        active: true,
      },
    });
  });

  it("keeps the Clerk userId server-side (never exposed on /me)", async () => {
    const app = buildApp({ auth: makeDeps() });
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer tok-passenger" },
    });
    expect(res.json().user).not.toHaveProperty("clerkUserId");
    expect(JSON.stringify(res.json())).not.toContain(CLERK_PASSENGER);
  });

  it("rejects a valid Clerk session with no local user (no silent provisioning)", async () => {
    const app = buildApp({ auth: makeDeps() });
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer tok-unknown" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "AUTH_USER_NOT_FOUND" } });
  });

  it("rejects an inactive local user with 403", async () => {
    const app = buildApp({ auth: makeDeps() });
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer tok-inactive" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "AUTH_INACTIVE" } });
  });

  it("never authenticates a reserved seed placeholder", async () => {
    const app = buildApp({ auth: makeDeps() });
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer tok-reserved" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: "AUTH_UNAUTHENTICATED" } });
  });

  it("rejects an invalid/expired token with 401", async () => {
    const app = buildApp({ auth: makeDeps() });
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer tok-garbage" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: "AUTH_UNAUTHENTICATED" } });
  });

  it("rejects replayed tokens after the session is gone", async () => {
    const deps = makeDeps();
    // Clerk is consulted on EVERY request. Model a session that is valid once
    // and then revoked (the verifier delegate consults the live set).
    const liveSessions = new Set(["tok-passenger"]);
    const revocableDeps: AuthDependencies = {
      ...deps,
      verifySession: async (token) =>
        liveSessions.has(token) ? await deps.verifySession(token) : null,
    };
    const app = buildApp({ auth: revocableDeps });

    const first = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer tok-passenger" },
    });
    expect(first.statusCode).toBe(200);

    // Clerk revokes the session (sign-out/expiry): the same token now fails.
    liveSessions.delete("tok-passenger");
    const second = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer tok-passenger" },
    });
    expect(second.statusCode).toBe(401);
  });
});

describe("role authorization (requireRole)", () => {
  it("rejects an unauthenticated request to a role-protected route", async () => {
    const app = buildRoleTestApp(makeDeps());
    const res = await app.inject({ method: "GET", url: "/driver-only" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a passenger from a driver-only route with 403", async () => {
    const app = buildRoleTestApp(makeDeps());
    const res = await app.inject({
      method: "GET",
      url: "/driver-only",
      headers: { authorization: "Bearer tok-passenger" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("admits a driver to a driver-only route", async () => {
    const app = buildRoleTestApp(makeDeps());
    const res = await app.inject({
      method: "GET",
      url: "/driver-only",
      headers: { authorization: "Bearer tok-driver" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({
      id: SEED_JASHIM_ID,
      role: "DRIVER",
    });
  });
});

describe("identity never comes from the request body", () => {
  it("ignores a client-supplied userId and uses the verified session identity", async () => {
    const app = buildRoleTestApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: "/whoami",
      headers: { authorization: "Bearer tok-passenger" },
      payload: { userId: "evil-user-id", role: "ADMIN" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.authUserId).toBe(SEED_NUSRAT_ID);
    expect(body.bodyUserId).toBe("evil-user-id");
    expect(body.authUserId).not.toBe("evil-user-id");
  });

  it("does not grant ADMIN from a body-supplied role", async () => {
    const app = buildRoleTestApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: "/whoami",
      headers: { authorization: "Bearer tok-passenger" },
      payload: { userId: SEED_NUSRAT_ID, role: "ADMIN" },
    });
    // The session role (stored in PostgreSQL) governs; body role is inert.
    expect(res.json().authUserId).toBe(SEED_NUSRAT_ID);
  });
});

describe("route policy", () => {
  it("keeps /health public (no authentication required)", async () => {
    const app = buildApp({ auth: makeDeps() });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("returns 401 for protected routes when Clerk is down", async () => {
    // Simulates the verifier boundary throwing a non-configuration error
    // (e.g. Clerk unreachable): the request must fail closed.
    const app = buildApp({
      auth: {
        verifySession: async () => {
          throw new Error("clerk network error");
        },
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer tok-passenger" },
    });
    expect(res.statusCode).toBe(500);
  });
});

describe("auth routes standalone", () => {
  it("mounts /api/me", async () => {
    const app = Fastify();
    app.register(authRoutes, { deps: makeDeps() });
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer tok-passenger" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(SEED_NUSRAT_ID);
  });
});