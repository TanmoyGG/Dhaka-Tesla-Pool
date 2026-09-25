// Fare model constants (ADR-015). All money is integer paisa/poysha (1 BDT =
// 100 paisa), never floating point. Values follow docs/requirements.md §21.D/H.

// Flat fare charged per seat for every ride.
export const FARE_BASE_PAISA = 3000;

// Distance charge per road kilometre, per seat.
export const FARE_PER_KM_PAISA = 1200;

// Straight-line (haversine) distance is multiplied by this factor to
// approximate the actual road distance. No routing service is used.
export const FARE_ROAD_FACTOR = 1.3;

// Mean Earth radius used by the haversine formula.
export const EARTH_RADIUS_KM = 6371;

// ISO-4217 currency code stored on every fare row (fares.currency, CHAR(3)).
export const FARE_CURRENCY = "BDT";

// MVP Tesla capacity: a passenger may request at most this many seats. Backed
// by the zod schema; the database enforces only positivity.
export const MAX_REQUESTED_SEATS = 3;

// Pooled-fare discount (ADR-016/017, docs/requirements.md §21.D): when a pool
// has at least POOLED_DISCOUNT_MIN_MEMBERS ACTIVE members, every ACTIVE
// member's fare is reduced by POOLED_DISCOUNT_RATE of (base + distance).
// 0.25 is exact in binary multiplication for the paisa sizes we handle, so
// pooledDiscountPaisa stays deterministic.
export const POOLED_DISCOUNT_RATE = 0.25;
export const POOLED_DISCOUNT_MIN_MEMBERS = 2;