import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    service: "dhaka-tesla-pool-api",
    version: "0.1.0",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));
};