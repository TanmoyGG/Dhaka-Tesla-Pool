// Resolves a verified Clerk userId to the local application user record
// (users.clerk_user_id). This is the "authenticated identity → application
// user → role/authorization" step of the flow. It never accepts a role from
// anywhere but PostgreSQL. It never creates a user — except through the
// explicit upsertLocalUser() used by first-request provisioning (ADR-014).
//
// Exported as a factory (createUserResolver) so the database test suite can
// inject its disposable `_test` database instead of the application singleton.
// The app-facing functions resolveLocalUser / upsertLocalUser use that
// singleton by default.

import { eq } from "drizzle-orm";
import { db, type AppDatabase } from "../db/index.js";
import { users } from "../db/schema.js";
import {
  isReservedClerkUserId,
  ProvisioningError,
  type AuthUser,
  type LocalUserResolver,
} from "./identity.js";

// What provisioning writes for a brand-new local user. Both values come ONLY
// from the verified Clerk profile, never from the client.
export interface ProvisionProfile {
  name: string;
  email: string;
}

export type UpsertLocalUser = (
  clerkUserId: string,
  profile: ProvisionProfile,
) => Promise<AuthUser>;

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
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
}

// Drizzle/postgres.js constraint violations surface a PostgreSQL error with
// code 23505 ("unique_violation"); drizzle may wrap it as the error's .cause.
function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string } | undefined)?.code ??
    (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  return code === "23505";
}

export function createUserResolver(database: AppDatabase): {
  resolveLocalUser: LocalUserResolver;
  upsertLocalUser: UpsertLocalUser;
} {
  const resolveLocalUser: LocalUserResolver = async (clerkUserId) => {
    // Defense in depth: reserved seed placeholders are NOT identities. A real
    // Clerk userId starts with "user_" and can never equal a reserved value,
    // but we reject the prefix explicitly so a placeholder can never be an
    // authenticated identity.
    if (isReservedClerkUserId(clerkUserId)) {
      return null;
    }

    const [row] = await database
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);

    if (!row) {
      return null;
    }

    return toAuthUser(row);
  };

  // Creates the application user for a verified Clerk identity (first-request
  // provisioning, ADR-014). Idempotent and race-safe: relies on the
  // users_clerk_user_id unique index with INSERT ... ON CONFLICT DO NOTHING, so
  // two concurrent first requests for the same identity yield exactly ONE user
  // row — the loser re-reads the winner.
  //
  // No explicit transaction is needed: the INSERT is the single atomic commit.
  // If the INSERT instead violates users_email_unique (the email already
  // belongs to another user), provisioning ABORTS with a ProvisioningError —
  // it never rebinds an existing row to a different Clerk identity.
  const upsertLocalUser: UpsertLocalUser = async (
    clerkUserId,
    profile,
  ) => {
    // Defense in depth: reserved seed placeholders can never be provisioned.
    // (The auth installer already 401s reserved identities before this runs.)
    if (isReservedClerkUserId(clerkUserId)) {
      throw new ProvisioningError(
        "Reserved development-only seed identities can never be provisioned as application users.",
      );
    }

    try {
      const [inserted] = await database
        .insert(users)
        .values({
          clerkUserId,
          name: profile.name,
          // users.email is constrained lowercase; normalize the verified value.
          email: profile.email.trim().toLowerCase(),
          role: "PASSENGER",
          active: true,
        })
        .onConflictDoNothing({ target: users.clerkUserId })
        .returning();

      if (inserted) {
        return toAuthUser(inserted);
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ProvisioningError(
          `Cannot provision a local user for Clerk identity ${clerkUserId}: ` +
            `its email "${profile.email}" is already associated with another ` +
            "application user. Reassign the existing row's clerk_user_id or " +
            "register a different email.",
        );
      }
      throw error;
    }

    // ANOTHER request created this identity's row between our (empty) INSERT
    // and this read. Return the winner's row instead of creating a duplicate.
    const existing = await resolveLocalUser(clerkUserId);
    if (!existing) {
      throw new ProvisioningError(
        `Provisioning for Clerk identity ${clerkUserId} did not produce a local user.`,
      );
    }
    return existing;
  };

  return { resolveLocalUser, upsertLocalUser };
}

// App-facing defaults bound to the application database singleton.
const defaultResolver = createUserResolver(db);

export const resolveLocalUser: LocalUserResolver =
  defaultResolver.resolveLocalUser;

export const upsertLocalUser: UpsertLocalUser = defaultResolver.upsertLocalUser;