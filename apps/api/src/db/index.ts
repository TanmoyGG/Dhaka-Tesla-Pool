import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";

// postgres-js connects lazily: creating the client does not touch the network,
// so the API can start even when the database is down. Use a single connection
// for the MVP (pooling strategy is a later-phase concern).
const client = postgres(config.databaseUrl, { max: 1 });

export const db = drizzle(client, { logger: false });