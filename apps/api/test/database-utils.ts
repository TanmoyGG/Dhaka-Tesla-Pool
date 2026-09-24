// Helpers for the database integration tests. Each test run works against a
// dedicated, disposable database (`<db>_test`) so it never touches the local
// development data. If the configured PostgreSQL server is reachable the tests
// run for real; otherwise the suite is skipped (see comments in
// test/database.test.ts).

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const TEST_DATABASE_SUFFIX = "_test";

export interface DbLocation {
  host: string;
  port: number;
  username: string;
  password: string;
  dbName: string;
}

// Parses postgres://user:pass@host:port/dbname URLs.
export function parseDatabaseUrl(url: string): DbLocation {
  const parsed = new URL(url);
  return {
    username: parsed.username !== "" ? parsed.username : "postgres",
    password: parsed.password,
    host: parsed.hostname,
    port: parsed.port !== "" ? Number(parsed.port) : 5432,
    dbName: parsed.pathname.replace(/^\//, ""),
  };
}

export function buildUrl(
  loc: DbLocation,
  dbName: string = loc.dbName,
): string {
  return `postgres://${loc.username}:${encodeURIComponent(loc.password)}@${loc.host}:${loc.port}/${dbName}`;
}

// Probe: can we reach the configured database at all? Guards the suite so
// `npm test` stays green on machines without Docker/Postgres running.
export async function isDatabaseReachable(url: string): Promise<boolean> {
  try {
    const client = postgres(url, { max: 1, connect_timeout: 2 });
    await client`select 1 as ok`;
    await client.end();
    return true;
  } catch {
    return false;
  }
}

// Drops and recreates the dedicated test database (destructive ONLY to the
// *_test database), returning its connection URL.
export async function resetTestDatabase(url: string): Promise<string> {
  const loc = parseDatabaseUrl(url);
  const testDbName = `${loc.dbName}${TEST_DATABASE_SUFFIX}`;
  const admin = postgres(buildUrl(loc), { max: 1 });
  try {
    // FORCE terminates any lingering connections (PG 13+; we run PG 16).
    await admin.unsafe(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${testDbName}"`);
  } finally {
    await admin.end();
  }
  return buildUrl(loc, testDbName);
}

// Applies the Drizzle migrations (./drizzle) to the given database.
export async function applyMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, prepare: false });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}