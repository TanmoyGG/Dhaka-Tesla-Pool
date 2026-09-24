import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { config } from "./config.js";

async function main(): Promise<void> {
  const app: FastifyInstance = buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Dhaka Tesla Pool API listening on http://${config.host}:${config.port}`);
}

main().catch((error: unknown) => {
  console.error("failed to start API:", error);
  process.exit(1);
});