// First-request user provisioning (ADR-014).
//
// When a VERIFIED Clerk identity has no local application user yet (users row
// matched by users.clerk_user_id), the auth flow provisions one on first use.
// That is this module's job: load the verified Clerk profile server-side and
// store it atomically, without ever trusting the client.
//
// Mapping (documented in README "Authentication" and docs/decisions.md ADR-014):
//   Clerk user ID                     -> users.clerk_user_id  (identity key)
//   Clerk username (required @signup) -> users.name           (display value)
//   Clerk primary email               -> users.email          (lowercased)
//   new users                         -> role PASSENGER, active true
//
// Webhooks are deliberately NOT used: there is no external signup pipeline to
// wait for, no event system, and no way for the API to fall behind. The row is
// created lazily on the first authenticated request, transactionally, so new
// signups just work. DRIVER/ADMIN are NEVER self-assignable and remain
// database-only assignments.

import {
  AuthConfigurationError,
  ProvisioningError,
  type AuthUser,
  type ProvisionLocalUser,
} from "./identity.js";
import { getClerkClient } from "./provider.js";
import { upsertLocalUser } from "./user-resolver.js";

// The default provisionLocalUser for AuthDependencies (wired in app.ts).
// Returns the freshly provisioned local user; throws ProvisioningError on any
// failure so the request fails closed with AUTH_PROVISION_FAILED and no
// partial row is ever written.
export const provisionLocalUser: ProvisionLocalUser = async (
  clerkUserId,
): Promise<AuthUser | null> => {
  let name: string;
  let email: string;
  try {
    const clerkUser = await getClerkClient().users.getUser(clerkUserId);

    // Signup requires a username, so it is normally present. If it is ever
    // missing we abort rather than invent a display name.
    if (!clerkUser.username) {
      throw new ProvisioningError(
        `Clerk identity ${clerkUserId} has no username; cannot derive a local display name.`,
      );
    }

    // The verified primary email address; the app never trusts one supplied
    // by the client.
    const primaryEmail = clerkUser.primaryEmailAddress;
    if (!primaryEmail?.emailAddress) {
      throw new ProvisioningError(
        `Clerk identity ${clerkUserId} has no verifiable email; cannot provision a local user.`,
      );
    }

    name = clerkUser.username;
    email = primaryEmail.emailAddress;
  } catch (error) {
    if (error instanceof ProvisioningError) {
      throw error;
    }
    if (error instanceof AuthConfigurationError) {
      throw new ProvisioningError(
        "Clerk authentication is not configured, so user provisioning is unavailable.",
      );
    }
    throw new ProvisioningError(
      `The Clerk profile for identity ${clerkUserId} could not be loaded; ` +
        "provisioning aborted without creating a user.",
    );
  }

  return upsertLocalUser(clerkUserId, { name, email });
};