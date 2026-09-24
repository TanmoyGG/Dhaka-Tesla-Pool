import type { FastifyError, FastifyInstance } from "fastify";
import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";

export interface BuildAppOptions {
  logger?: boolean | object;
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

  app.register(healthRoutes, { prefix: "/" });

  return app;
}