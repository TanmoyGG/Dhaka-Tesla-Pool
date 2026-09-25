// Ride-request routes (mounted under /api, same trust conventions as the auth
// routes: installAuthContext powers requireAuth/requireRole, and the rides
// service asked for passenger data ONLY from request.auth — never the body).

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AuthDependencies } from "../auth/identity.js";
import { installAuthContext } from "../auth/install.js";
import { MAX_REQUESTED_SEATS } from "../fare/constants.js";
import { RideValidationError } from "./errors.js";
import type { RideRequestInput, RideService } from "./service.js";

export interface RidesRoutesOptions {
  deps: AuthDependencies;
  rides: RideService;
}

// Strict body: unknown extra fields are rejected rather than silently dropped.
const rideRequestSchema = z
  .object({
    pickupZoneId: z.string().uuid("must be a valid UUID"),
    destinationZoneId: z.string().uuid("must be a valid UUID"),
    requestedSeats: z
      .number({ invalid_type_error: "must be a number" })
      .int("must be an integer")
      .min(1, "must be at least 1")
      .max(MAX_REQUESTED_SEATS, `must be at most ${MAX_REQUESTED_SEATS}`),
    // Optional client-generated idempotency key (ADR-015). Without it, a
    // repeated submission may create a new ride.
    clientRequestId: z.string().uuid("must be a valid UUID").nullish(),
  })
  .strict();

const rideParamsSchema = z.object({
  rideId: z.string().uuid("must be a valid UUID"),
});

function zodIssues(error: z.ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "body",
    message: issue.message,
  }));
}

export const ridesRoutes: FastifyPluginAsync<RidesRoutesOptions> = async (
  app,
  options,
) => {
  await app.register(async (scope) => {
    installAuthContext(scope, options.deps);

    // Every ride/zone route under /api requires a verified Clerk session.
    scope.addHook("preHandler", scope.requireAuth());

    scope.get("/zones", async () => ({
      zones: await options.rides.listZones(),
    }));

    scope.post(
      "/rides",
      { preHandler: [scope.requireRole(["PASSENGER"])] },
      async (request, reply) => {
        const parsed = rideRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new RideValidationError(zodIssues(parsed.error));
        }
        const input: RideRequestInput = {
          pickupZoneId: parsed.data.pickupZoneId,
          destinationZoneId: parsed.data.destinationZoneId,
          requestedSeats: parsed.data.requestedSeats,
          clientRequestId: parsed.data.clientRequestId ?? null,
        };
        const result = await options.rides.createRequest(
          request.auth!.user,
          input,
        );
        // 201 on first creation; 200 when an idempotent retry replayed the
        // ride that already existed for this (passenger, clientRequestId).
        reply.code(result.created ? 201 : 200);
        return { ride: result.ride };
      },
    );

    scope.get(
      "/rides",
      { preHandler: [scope.requireRole(["PASSENGER"])] },
      async (request) => ({
        rides: await options.rides.listOwnedRides(request.auth!.user),
      }),
    );

    scope.get<{ Params: { rideId: string } }>(
      "/rides/:rideId",
      { preHandler: [scope.requireRole(["PASSENGER"])] },
      async (request) => {
        const parsed = rideParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          throw new RideValidationError(zodIssues(parsed.error));
        }
        const ride = await options.rides.getOwnedRide(
          request.auth!.user,
          parsed.data.rideId,
        );
        return { ride };
      },
    );

    // Passenger cancels their own ride (docs/requirements.md §21.B). Only the
    // ride's owner may cancel it; an illegal transition (e.g. cancelling a
    // COMPLETED ride) is rejected with 409 INVALID_STATE_TRANSITION.
    scope.post<{ Params: { rideId: string } }>(
      "/rides/:rideId/cancel",
      { preHandler: [scope.requireRole(["PASSENGER"])] },
      async (request) => {
        const parsed = rideParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          throw new RideValidationError(zodIssues(parsed.error));
        }
        const ride = await options.rides.cancelRequest(
          request.auth!.user,
          parsed.data.rideId,
        );
        return { ride };
      },
    );
  }, { prefix: "/api" });
};