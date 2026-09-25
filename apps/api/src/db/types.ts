// Shared structural type for a Drizzle PostgreSQL transaction, so pooling
// services can accept the transaction handed to them by `database.transaction`
// without importing the singleton DB client (avoids init side-effects / cycles).
import type { AppDatabase } from "./index.js";

export type DbTransaction = Parameters<
  Parameters<AppDatabase["transaction"]>[0]
>[0];