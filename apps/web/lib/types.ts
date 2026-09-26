// TypeScript mirror of the backend API contract (source of truth:
// apps/api/src/rides/service.ts RideView / ZoneView / FareView /
// RidePoolView, apps/api/src/rides/pooling/service.ts DriverPoolView /
// DriverPoolMemberView, apps/api/src/auth/routes.ts /me, and the API error
// envelope in apps/api/src/app.ts).
//
// These shapes match what the JSON API returns. Backend Date fields serialize
// to ISO-8601 strings on the wire, so they are typed as `string` here.

export type RideStatus =
  | "REQUESTED"
  | "MATCHED"
  | "DRIVER_ARRIVED"
  | "STARTED"
  | "COMPLETED"
  | "CANCELLED";

export type UserRole = "PASSENGER" | "DRIVER" | "ADMIN";

// Statuses that can no longer change. Polling stops once a ride/pool lands
// here (no pointless long-poll — the trip is over).
export const TERMINAL_STATUSES: ReadonlySet<RideStatus> = new Set([
  "COMPLETED",
  "CANCELLED",
]);

export function isTerminal(status: RideStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface ZoneView {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface FareView {
  currency: string;
  baseFarePaisa: number;
  distanceChargePaisa: number;
  poolDiscountPaisa: number;
  finalFarePaisa: number;
  perSeatFarePaisa: number;
  estimatedTotalPaisa: number;
}

// The pool a PASSENGER rides in (rides/service.ts): driver + Tesla + fill.
export interface RidePoolView {
  id: string;
  status: RideStatus;
  capacitySnapshot: number;
  occupiedSeats: number;
  vehicleId: string;
  vehicleName: string;
  driverId: string;
  driverName: string;
  createdAt: string;
  updatedAt: string;
}

export interface RideView {
  id: string;
  status: RideStatus;
  pickupZone: ZoneView;
  destinationZone: ZoneView;
  requestedSeats: number;
  fare: FareView;
  pool: RidePoolView | null;
  createdAt: string;
  updatedAt: string;
}

// The pool view the DRIVER sees (pooling/service.ts): the passenger members,
// NO per-passenger fares (P9). Deliberately a different surface from
// RidePoolView.
export interface DriverPoolMemberView {
  rideRequestId: string;
  passengerId: string;
  passengerName: string;
  pickupZoneId: string;
  pickupZoneName: string;
  destinationZoneId: string;
  destinationZoneName: string;
  seats: number;
}

export interface DriverPoolView {
  id: string;
  status: RideStatus;
  capacitySnapshot: number;
  occupiedSeats: number;
  vehicle: { id: string; name: string; capacity: number; isOnline: boolean };
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  members: DriverPoolMemberView[];
}

export interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    active: boolean;
  };
}

export interface ZonesResponse {
  zones: ZoneView[];
}

export interface RidesResponse {
  rides: RideView[];
}

export interface RideResponse {
  ride: RideView;
}

export interface EstimateResponse {
  fare: FareView;
}

export interface DriverPoolsResponse {
  pools: DriverPoolView[];
}

export interface DriverPoolResponse {
  pool: DriverPoolView;
}

export interface DriverAvailabilityResponse {
  availability: { isOnline: boolean };
}

// Cancellation is only legal while the ride is still cancellable
// (docs/requirements.md §21.B): REQUESTED, MATCHED, DRIVER_ARRIVED.
// STARTED, COMPLETED, and CANCELLED must never offer a cancel action.
export const CANCELLABLE_STATUSES: ReadonlySet<RideStatus> = new Set([
  "REQUESTED",
  "MATCHED",
  "DRIVER_ARRIVED",
]);

export function isCancellable(status: RideStatus): boolean {
  return CANCELLABLE_STATUSES.has(status);
}