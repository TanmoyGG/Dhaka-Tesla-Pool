// Driver workflow routes (mounted under /api, same trust conventions as the
// rides routes): the driver identity is taken ONLY from request.auth — never
// from the body — and every route here is guarded to DRIVER-role callers.

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AuthDependencies } from "../auth/identity.js";
import { installAuthContext } from "../auth/install.js";
import { RideValidationError } from "../rides/errors.js";
import type { DriverService } from "./service.js";

export interface DriverRoutesOptions {
  deps: AuthDependencies;
  driver: DriverService;
}

// Strict body: unknown extra fields are rejected rather than silently dropped.
const availabilitySchema = z
  .object({
    isOnline: z.boolean({
      invalid_type_error: "must be a boolean",
    }),
  })
  .strict();

const poolParamsSchema = z.object({
  poolId: z.string().uuid("must be a valid UUID"),
});

function zodIssues(error: z.ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "body",
    message: issue.message,
  }));
}

export const driverRoutes: FastifyPluginAsync<DriverRoutesOptions> = async (
  app,
  options,
) => {
  await app.register(async (scope) => {
    installAuthContext(scope, options.deps);

    // Every /api/driver route requires a verified session AND a DRIVER role.
    // A passenger reaching these routes gets 403 (FORBIDDEN); an
    // unauthenticated caller gets 401.
    scope.addHook("preHandler", scope.requireRole(["DRIVER"]));

    async function parsePoolId(params: { poolId: string }): Promise<string> {
      const parsed = poolParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new RideValidationError(zodIssues(parsed.error));
      }
      return parsed.data.poolId;
    }

    // Online/offline toggle. Body-carried flag, driver identity from the
    // session. 204 on success; 409 DRIVER_HAS_ACTIVE_POOL when going offline
    // would strand a non-terminal pool (requirements.md §21.J).
    scope.post("/driver/availability", async (request, reply) => {
      const parsed = availabilitySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new RideValidationError(zodIssues(parsed.error));
      }
      await options.driver.setAvailability(
        request.auth!.user.id,
        parsed.data.isOnline,
      );
      return reply.code(204).send();
    });

    // The driver hub: every non-terminal pool this driver owns, newest first.
    scope.get("/driver/pools", async (request) => ({
      pools: await options.driver.listDriverPools(request.auth!.user.id),
    }));

    scope.get<{ Params: { poolId: string } }>(
      "/driver/pools/:poolId",
      async (request) => {
        const poolId = await parsePoolId(request.params);
        const pool = await options.driver.getDriverPool(
          request.auth!.user.id,
          poolId,
        );
        return { pool };
      },
    );

    // Lifecycle actions. Idempotent where documented (accept), else 409 on a
    // premature/illegal move. The pool view is returned after each action.
    const lifecycle = (
      action: (driverId: string, poolId: string) => Promise<unknown>,
    ) => async (request: {
      params: { poolId: string };
      auth: { user: { id: string } } | null;
    }) => {
      const poolId = await parsePoolId(request.params);
      const pool = await action(request.auth!.user.id, poolId);
      return { pool };
    };

    scope.post<{ Params: { poolId: string } }>(
      "/driver/pools/:poolId/accept",
      lifecycle(options.driver.acceptPool),
    );
    scope.post<{ Params: { poolId: string } }>(
      "/driver/pools/:poolId/arrive",
      lifecycle(options.driver.arrivePool),
    );
    scope.post<{ Params: { poolId: string } }>(
      "/driver/pools/:poolId/start",
      lifecycle(options.driver.startPool),
    );
    scope.post<{ Params: { poolId: string } }>(
      "/driver/pools/:poolId/complete",
      lifecycle(options.driver.completePool),
    );
  }, { prefix: "/api" });
};