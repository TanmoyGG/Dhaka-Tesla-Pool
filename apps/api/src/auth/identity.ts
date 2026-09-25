// Auth identity boundaries for the Dhaka Tesla Pool API.
//
// Clerk owns authentication (verifying who you are). This module defines the
// constants and types shared by the Clerk integration and the application
// user resolution, and documents the trust boundary between them.

// Development-only placeholder prefix used by the seed for users that have no
// real Clerk identity yet. Real Clerk user IDs are opaque strings that start
// with "user_" (e.g. "user_2abcdef..."), so a value bearing this prefix can
// never be produced by a verified Clerk session. The user resolver ALSO
// rejects any ID with this prefix as a defense-in-depth guard, so a reserved
// placeholder can never be treated as an authenticated identity.
export const RESERVED_CLERK_USER_ID_PREFIX = "dev-only::seed::";

// Deterministic reserved placeholder for the seed (stable per email).
export function seedClerkUserId(email: string): string {
  return `${RESERVED_CLERK_USER_ID_PREFIX}${email}`;
}

export function isReservedClerkUserId(clerkUserId: string): boolean {
  return clerkUserId.startsWith(RESERVED_CLERK_USER_ID_PREFIX);
}

// The application roles stored in PostgreSQL (source of truth for
// authorization). Never accepted from the frontend or from Clerk.
export type AppUserRole = "PASSENGER" | "DRIVER" | "ADMIN";

// The application-owned user record as resolved for an authenticated request.
// This is what route handlers act on; they never trust a userId or role that
// came from the request body.
export interface AuthUser {
  id: string;
  clerkUserId: string;
  name: string;
  email: string;
  role: AppUserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Error raised when Clerk is not configured but an authenticated route is
// reached. Caught by the auth plugin and turned into a clear 500 config error,
// instead of an obscure crash.
export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

// The two injectable boundaries of the authentication flow. Injecting these
// is what keeps the auth logic testable without real Clerk (or a network):
// tests substitute a deterministic fake for each.
//
// verifySession(token)      — verifies a bearer session token with Clerk and
//                             returns the authenticated Clerk userId (or null).
// resolveLocalUser(clerkId) — maps a verified Clerk userId to the local
//                             application user via users.clerk_user_id.
export type SessionVerifier = (token: string) => Promise<string | null>;
export type LocalUserResolver = (clerkUserId: string) => Promise<AuthUser | null>;

export interface AuthDependencies {
  verifySession: SessionVerifier;
  resolveLocalUser: LocalUserResolver;
}