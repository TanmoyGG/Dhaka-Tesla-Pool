// Typed errors for the ride-request feature.
//
// These errors carry the fields the global Fastify error handler understands:
// a `statusCode`, an error `code`, and an optional `details` array that the
// handler adds to the response envelope (additively — existing consumers of
// { error: { code, message } } are unaffected).

export interface FieldIssue {
  field: string;
  message: string;
}

// Any client-supplied value that fails validation (malformed body, unknown
// zone id, seats out of range, pickup == destination, bad UUID). Maps to
// HTTP 400 with code VALIDATION_ERROR plus a details list for the client.
export class RideValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly statusCode = 400;
  readonly details: FieldIssue[];

  constructor(details: FieldIssue[]) {
    super(details.map((d) => `${d.field}: ${d.message}`).join("; "));
    this.name = "RideValidationError";
    this.details = details;
  }
}

// A ride the caller is not entitled to see (including one that does not exist
// at all — an observer must not be able to distinguish). Maps to 404.
export class RideNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly statusCode = 404;

  constructor() {
    super("Ride not found.");
    this.name = "RideNotFoundError";
  }
}

// An explicit state-machine transition the ride is not allowed to make (e.g.
// CANCELLING a COMPLETED ride, or a MATCHED ride with no membership). The
// service REFUSES to make the write — the row on disk is never corrupted and a
// passenger can never move another passenger's ride. Maps to 409.
export class InvalidStateTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION";
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "InvalidStateTransitionError";
  }
}

// A pool the caller is not entitled to act on (including one that does not
// exist at all — an observer must not be able to distinguish). Maps to 404.
export class PoolNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly statusCode = 404;

  constructor() {
    super("Pool not found.");
    this.name = "PoolNotFoundError";
  }
}

// A driver action that requires the pool's Tesla to be online (Phase 6). The
// pool's own vehicle row is authoritative, so accepting for another (offline)
// Tesla of the same driver is rejected too. Maps to 409.
export class VehicleOfflineError extends Error {
  readonly code = "VEHICLE_OFFLINE";
  readonly statusCode = 409;

  constructor() {
    super("The Tesla for this pool is offline.");
    this.name = "VehicleOfflineError";
  }
}

// Accept/arrive on a pool that is not in the actionable state (Phase 6): e.g.
// accepting a pool that already left MATCHED, or arriving before accepting.
// Maps to 409.
export class PoolNotAcceptableError extends Error {
  readonly code = "POOL_NOT_ACCEPTABLE";
  readonly statusCode = 409;

  constructor(message = "Pool is not in a state this action accepts.") {
    super(message);
    this.name = "PoolNotAcceptableError";
  }
}

// A driver tried to go offline while any of their pools is non-terminal
// (Phase 6, strict rule — requirements.md §21.J). Maps to 409.
export class DriverHasActivePoolError extends Error {
  readonly code = "DRIVER_HAS_ACTIVE_POOL";
  readonly statusCode = 409;

  constructor() {
    super("Cannot go offline while a pool is active.");
    this.name = "DriverHasActivePoolError";
  }
}