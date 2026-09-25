// Resolves a verified Clerk userId to the local application user record
// (users.clerk_user_id). This is the "authenticated identity → application
// user → role/authorization" step of the flow. It never creates a user and
// never accepts a role from anywhere but PostgreSQL.

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { isReservedClerkUserId, type LocalUserResolver } from "./identity.js";

export const resolveLocalUser: LocalUserResolver = async (clerkUserId) => {
  // Defense in depth: reserved seed placeholders are NOT identities. A real
  // Clerk userId starts with "user_" and can never equal a reserved value, but
  // we reject the prefix explicitly so a placeholder can never authenticate.
  if (isReservedClerkUserId(clerkUserId)) {
    return null;
  }

  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};