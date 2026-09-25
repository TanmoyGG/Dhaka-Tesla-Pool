// Authenticated application routes (mounted under /api).
//
// Only the application user/profile endpoint exists in this phase. Ride,
// passenger, and driver endpoints build on the same installAuthContext
// foundation in later phases. /health stays outside this prefix and public.

import type { FastifyPluginAsync } from "fastify";
import { installAuthContext } from "./install.js";
import type { AuthDependencies, AuthUser } from "./identity.js";

export interface AuthRoutesOptions {
  deps: AuthDependencies;
}

// The public shape of the current application user. clerkUserId is deliberately
// NOT exposed to the client: downstream handlers use request.auth internally.
function publicUser(user: AuthUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
  };
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  options,
) => {
  await app.register(async (scope) => {
    installAuthContext(scope, options.deps);

    scope.get("/me", { preHandler: [scope.requireAuth()] }, async (request) => {
      // The authenticated identity comes from the verified Clerk token and the
      // resolved local user — never from the request body.
      return { user: publicUser(request.auth!.user) };
    });
  }, { prefix: "/api" });
};