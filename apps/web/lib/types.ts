// TypeScript mirror of the backend API contract (source of truth:
// apps/api/src/rides/service.ts RideView / ZoneView / FareView / RidePoolView,
// and from the API error envelope in apps/api/src/app.ts).
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