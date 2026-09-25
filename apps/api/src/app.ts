import type { FastifyError, FastifyInstance } from "fastify";
import Fastify from "fastify";
import { authRoutes } from "./auth/routes.js";
import { createClerkSessionVerifier } from "./auth/provider.js";
import { resolveLocalUser } from "./auth/user-resolver.js";
import type { AuthDependencies } from "./auth/identity.js";
import { healthRoutes } from "./routes/health.js";

export interface BuildAppOptions {
  logger?: boolean | object;
  // Injectable auth boundaries (tests substitute fakes so the auth suite never
  // calls Clerk or the database). Defaults to the real Clerk + PostgreSQL
  // implementations.
  auth?: Partial<AuthDependencies>;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? {
      level: process.env.NODE_ENV === "test" ? "silent" : "info",
    },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "request failed");
    reply.status(error.statusCode ?? 500).send({
      error: {
        code: error.code ?? "INTERNAL_ERROR",
        message: error.message,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `route ${request.method} ${request.url} not found`,
      },
    });
  });

  // Public liveness probe — deliberately NOT behind authentication.
  app.register(healthRoutes, { prefix: "/" });

  // Everything under /api requires a verified Clerk session (bearer token).
  const authDeps: AuthDependencies = {
    verifySession: options.auth?.verifySession ?? createClerkSessionVerifier(),
    resolveLocalUser: options.auth?.resolveLocalUser ?? resolveLocalUser,
  };
  app.register(authRoutes, { deps: authDeps });

  return app;
}