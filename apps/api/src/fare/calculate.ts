// Deterministic fare estimation — pure functions, no I/O, no randomness.
//
// The estimate is calculated from the predefined zone coordinates (plain
// lat/long points; no routing service). Formula (docs/requirements.md §21.D/H,
// ADR-015):
//
//   distanceKm          = haversine(pickup, destination)         // great-circle
//   roadKm              = distanceKm × FARE_ROAD_FACTOR          // no real roads
//   distanceChargePaisa = roundHalfUp(roadKm × FARE_PER_KM_PAISA)
//   baseFarePaisa       = FARE_BASE_PAISA
//   poolDiscountPaisa   = 0 for a new request (pooled discount, later phase)
//   finalFarePaisa      = baseFarePaisa + distanceChargePaisa − poolDiscountPaisa
//
// The components stored in `fares` are PER SEAT; the total a passenger will pay
// is estimatedTotalPaisa = finalFarePaisa × requestedSeats. finalFarePaisa is
// derived from the other three components and is never rounded independently,
// so the database CHECK `final = base + distance − discount` holds by construction.
//
// Rounding: round-half-up on positive values (deterministic for the tests).

import {
  EARTH_RADIUS_KM,
  FARE_BASE_PAISA,
  FARE_CURRENCY,
  FARE_PER_KM_PAISA,
  FARE_ROAD_FACTOR,
} from "./constants.js";

export interface ZonePoint {
  latitude: number;
  longitude: number;
}

// Great-circle distance between two lat/long points in kilometres.
export function haversineKm(a: ZonePoint, b: ZonePoint): number {
  const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Round-half-up for non-negative values: a clean, documented rule that both
// the tests and the API can rely on (banker's rounding only matters at exact
// .5 boundaries; half-up is simpler to pin down).
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export const DEFAULT_POOL_DISCOUNT_PAISA = 0;

export interface FareEstimate {
  currency: typeof FARE_CURRENCY;
  baseFarePaisa: number;
  distanceChargePaisa: number;
  poolDiscountPaisa: number;
  finalFarePaisa: number;
  perSeatFarePaisa: number;
  estimatedTotalPaisa: number;
}

export interface FareInput {
  pickup: ZonePoint;
  destination: ZonePoint;
  requestedSeats: number;
}

// Initial estimate for a brand-new (REQUESTED) ride. poolDiscountPaisa is 0:
// the pooled discount (25% off base + distance) applies only once the request
// actually joins a pool — a later phase recomputes and updates the fare row.
export function computeInitialFare({
  pickup,
  destination,
  requestedSeats,
}: FareInput): FareEstimate {
  const distanceKm = haversineKm(pickup, destination);
  const roadKm = distanceKm * FARE_ROAD_FACTOR;
  const distanceChargePaisa = roundHalfUp(roadKm * FARE_PER_KM_PAISA);
  const baseFarePaisa = FARE_BASE_PAISA;
  const poolDiscountPaisa = DEFAULT_POOL_DISCOUNT_PAISA;
  const finalFarePaisa = baseFarePaisa + distanceChargePaisa - poolDiscountPaisa;

  return {
    currency: FARE_CURRENCY,
    baseFarePaisa,
    distanceChargePaisa,
    poolDiscountPaisa,
    finalFarePaisa,
    perSeatFarePaisa: finalFarePaisa,
    estimatedTotalPaisa: finalFarePaisa * requestedSeats,
  };
}