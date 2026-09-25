import type { FastifyError, FastifyInstance } from "fastify";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { authRoutes } from "./auth/routes.js";
import { createClerkSessionVerifier } from "./auth/provider.js";
import { provisionLocalUser } from "./auth/provision.js";
import { resolveLocalUser } from "./auth/user-resolver.js";
import type { AuthDependencies } from "./auth/identity.js";
import { db } from "./db/index.js";
import { ridesRoutes } from "./rides/routes.js";
import { createRideService, type RideService } from "./rides/service.js";
import { healthRoutes } from "./routes/health.js";

export interface BuildAppOptions {
  logger?: boolean | object;
  // Injectable auth boundaries (tests substitute fakes so the auth suite never
  // calls Clerk or the database). Defaults to the real Clerk + PostgreSQL
  // implementations.
  auth?: Partial<AuthDependencies>;
  // Injectable ride service (tests bind it to the disposable test database).
  // Defaults to the real PostgreSQL-backed service.
  rides?: RideService;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? {
      level: process.env.NODE_ENV === "test" ? "silent" : "info",
    },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "request failed");
    const body: {
      error: {
        code: string;
        message: string;
        details?: Array<{ field: string; message: string }>;
      };
    } = {
      error: {
        code: error.code ?? "INTERNAL_ERROR",
        message: error.message,
      },
    };
    // Additive envelope extension: validation errors carry per-field details.
    // { code, message } consumers are unaffected (docs/decisions.md ADR-015).
    const details = (error as { details?: unknown }).details;
    if (Array.isArray(details)) {
      body.error.details = details as Array<{ field: string; message: string }>;
    }
    reply.status(error.statusCode ?? 500).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `route ${request.method} ${request.url} not found`,
      },
    });
  });

  // Browser CORS for the web app (apps/web) calling this API cross-origin.
  // Only origins already vetted for Clerk token verification may pass: the
  // same WEB_URL / CLERK_AUTHORIZED_PARTIES list. No wildcard origins, and
  // only the headers/methods the MVP actually uses.
  app.register(cors, {
    origin: config.clerkAuthorizedParties,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  // Public liveness probe — deliberately NOT behind authentication.
  app.register(healthRoutes, { prefix: "/" });

  // Everything under /api requires a verified Clerk session (bearer token).
  // Unknown real identities are provisioned as PASSENGER users on first use.
  const authDeps: AuthDependencies = {
    verifySession: options.auth?.verifySession ?? createClerkSessionVerifier(),
    resolveLocalUser: options.auth?.resolveLocalUser ?? resolveLocalUser,
    provisionLocalUser: options.auth?.provisionLocalUser ?? provisionLocalUser,
  };
  app.register(authRoutes, { deps: authDeps });
  app.register(ridesRoutes, {
    deps: authDeps,
    rides: options.rides ?? createRideService(db),
  });

  return app;
}