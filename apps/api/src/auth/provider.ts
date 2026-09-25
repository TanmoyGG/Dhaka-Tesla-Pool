// The Clerk verification boundary — the ONLY place the API talks to Clerk.
//
// Everything else in the auth flow is application logic over the result of
// this function. Swapped for a fake in tests, so the auth suite never makes a
// Clerk/network call.

import { createClerkClient, type ClerkClient } from "@clerk/backend";
import { config } from "../config.js";
import { AuthConfigurationError, type SessionVerifier } from "./identity.js";

let clerkClient: ClerkClient | null = null;

function getClerkClient(): ClerkClient {
  if (!config.clerkSecretKey) {
    throw new AuthConfigurationError(
      "Clerk authentication is not configured: set CLERK_SECRET_KEY in the API environment. " +
        "CLERK_PUBLISHABLE_KEY is also recommended. Without these, authenticated routes are disabled.",
    );
  }
  // createClerkClient() with missing/invalid keys throws at construction; we
  // only construct it once configuration is present.
  if (clerkClient === null) {
    clerkClient = createClerkClient({
      secretKey: config.clerkSecretKey,
      publishableKey: config.clerkPublishableKey,
    });
  }
  return clerkClient;
}

// Verifies a Clerk session bearer token and returns the authenticated Clerk
// user ID (or null when the token is missing/invalid/expired). Uses Clerk's
// authenticateRequest() mechanism against a Web Request built from the token.
// Never logs the token. Throws AuthConfigurationError when Clerk is unset.
export function createClerkSessionVerifier(): SessionVerifier {
  return async (token: string): Promise<string | null> => {
    const client = getClerkClient();

    // authenticateRequest() needs a fetch-style Request; it reads the
    // Authorization header (the bearer token) to verify the session.
    const clerkRequest = new Request("http://api.internal/clerk/verify", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });

    const state = await client.authenticateRequest(clerkRequest, {
      secretKey: config.clerkSecretKey,
      publishableKey: config.clerkPublishableKey,
      // Allow only configured origins to present session tokens to this API
      // (CSRF / subdomain cookie-leak defence). Local default is the web
      // origin; production origins come from CLERK_AUTHORIZED_PARTIES.
      authorizedParties: config.clerkAuthorizedParties,
    });

    if (!state.isAuthenticated) {
      return null;
    }
    return state.toAuth().userId ?? null;
  };
}