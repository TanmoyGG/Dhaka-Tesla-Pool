import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The DB-backed suites (test/database.test.ts and test/rides.test.ts) both
    // reset the same disposable `_test` database in beforeAll. Running test
    // files sequentially keeps that reset from racing (DROP DATABASE …
    // WITH (FORCE) vs a concurrent CREATE/MIGRATE on the same name).
    fileParallelism: false,
  },
});