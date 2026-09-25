// Auth context installer for Fastify.
//
// installAuthContext() wires the authentication preHandler and the reusable
// authorization helpers (requireAuth / requireRole) onto a scope of the API.
// Route handlers never trust a userId/role from the request body: the
// authenticated application user is always taken from request.auth, which is
// built from the verified Clerk identity.

import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  AUTH_PROVISION_FAILED,
  AuthConfigurationError,
  isReservedClerkUserId,
  ProvisioningError,
  type AppUserRole,
  type AuthDependencies,
  type AuthUser,
} from "./identity.js";

declare module "fastify" {
  interface FastifyRequest {
    // The authenticated application user, attached by the auth preHandler.
    // null unless a verified Clerk session resolved to a local user.
    auth: { user: AuthUser } | null;
  }

  interface FastifyInstance {
    requireAuth: () => preHandlerHookHandler;
    requireRole: (roles: AppUserRole[]) => preHandlerHookHandler;
  }
}

export interface AuthErrorPayload {
  error: {
    code: string;
    message: string;
  };
}

export function authError(code: string, message: string): AuthErrorPayload {
  return { error: { code, message } };
}

// "Bearer <token>"; returns just the token or null when the header is missing
// or not a bearer token. The token is used only for Clerk verification and is
// never logged.
function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || rest.length === 0) {
    return null;
  }
  return rest.join(" ");
}

const requireAuthHook: preHandlerHookHandler = async (request, reply) => {
  if (!request.auth) {
    return reply
      .code(401)
      .send(authError("AUTH_UNAUTHENTICATED", "Authentication required."));
  }
};

function requireRoleHook(roles: AppUserRole[]): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.auth) {
      return reply
        .code(401)
        .send(authError("AUTH_UNAUTHENTICATED", "Authentication required."));
    }
    if (!roles.includes(request.auth.user.role)) {
      return reply
        .code(403)
        .send(
          authError(
            "FORBIDDEN",
            `Access denied: requires one of the roles ${roles.join(", ")}.`,
          ),
        );
    }
  };
}

export function installAuthContext(
  app: FastifyInstance,
  deps: AuthDependencies,
): void {
  app.decorateRequest("auth", null);

  app.addHook("preHandler", async (request, reply) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return reply
        .code(401)
        .send(
          authError(
            "AUTH_UNAUTHENTICATED",
            "Missing bearer token. Send an Authorization header: `Bearer <clerk-session-token>`.",
          ),
        );
    }

    let clerkUserId: string | null;
    try {
      clerkUserId = await deps.verifySession(token);
    } catch (error) {
      if (error instanceof AuthConfigurationError) {
        request.log.warn({ code: "AUTH_CONFIGURATION" }, error.message);
        return reply
          .code(500)
          .send(authError("AUTH_CONFIGURATION", error.message));
      }
      throw error;
    }

    // Only a real, reserved-free Clerk identity is accepted. Reserved seed
    // placeholders can never authenticate even if a resolver matched one.
    if (!clerkUserId || isReservedClerkUserId(clerkUserId)) {
      return reply
        .code(401)
        .send(
          authError(
            "AUTH_UNAUTHENTICATED",
            "The Clerk session token is invalid or expired.",
          ),
        );
    }

    let user = await deps.resolveLocalUser(clerkUserId);
    if (!user) {
      // Valid real Clerk identity with no local user yet: provision one from
      // the verified Clerk profile (first-request provisioning, ADR-014).
      // Provisioning is atomic — a failure must not leave a partial row.
      try {
        user = await deps.provisionLocalUser(clerkUserId);
      } catch (error) {
        if (error instanceof ProvisioningError) {
          request.log.warn(
            { code: AUTH_PROVISION_FAILED },
            error.message,
          );
          return reply
            .code(500)
            .send(authError(AUTH_PROVISION_FAILED, error.message));
        }
        throw error;
      }
      if (!user) {
        // Defensive backstop: a provisionLocalUser that deliberately returns
        // null (real but explicitly not-provisionable identity) keeps the
        // original contract — a valid identity with no application user.
        return reply
          .code(403)
          .send(
            authError(
              "AUTH_USER_NOT_FOUND",
              "The authenticated Clerk identity has no application user record.",
            ),
          );
      }
    }
    if (!user.active) {
      return reply
        .code(403)
        .send(
          authError(
            "AUTH_INACTIVE",
            "This application user account is inactive.",
          ),
        );
    }

    request.auth = { user };
  });

  app.decorate("requireAuth", () => requireAuthHook);
  app.decorate("requireRole", (roles: AppUserRole[]) => requireRoleHook(roles));
}