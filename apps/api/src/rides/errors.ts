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