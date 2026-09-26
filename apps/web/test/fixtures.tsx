// Shared fixture builders for web component tests. They mirror the canonical
// cast (Nusrat's ride, Rafiq joining the same pool, Bullet the Tesla) so the
// story stays consistent with seeds and backend tests.

import type {
  DriverPoolMemberView,
  DriverPoolView,
  FareView,
  RidePoolView,
  RideView,
  ZoneView,
} from "@/lib/types";

export function makeZone(
  overrides: Partial<ZoneView> = {},
): ZoneView {
  return {
    id: "b1a60c28-92e6-4f87-b2a4-6f5e8f3d11aa",
    name: "Banani",
    latitude: 23.7896,
    longitude: 90.4022,
    ...overrides,
  };
}

const NUSRAT_ID = "7c0f40a0-0000-0000-0000-000000000004";
const BULLET_ID = "c1c6e11f-0000-0000-0000-000000000001";

export function makeFare(overrides: Partial<FareView> = {}): FareView {
  return {
    currency: "BDT",
    baseFarePaisa: 3000,
    distanceChargePaisa: 2932,
    poolDiscountPaisa: 0,
    finalFarePaisa: 5932,
    perSeatFarePaisa: 5932,
    estimatedTotalPaisa: 5932,
    ...overrides,
  };
}

export function makeRidePool(overrides: Partial<RidePoolView> = {}): RidePoolView {
  return {
    id: "d1f9d4a0-0000-0000-0000-000000000001",
    status: "MATCHED",
    capacitySnapshot: 3,
    occupiedSeats: 1,
    vehicleId: BULLET_ID,
    vehicleName: "Bullet",
    driverId: "7c0f40a0-0000-0000-0000-000000000001",
    driverName: "Jashim Ahmed",
    createdAt: "2026-09-27T10:00:00.000Z",
    updatedAt: "2026-09-27T10:00:00.000Z",
    ...overrides,
  };
}

export function makeRide(overrides: Partial<RideView> = {}): RideView {
  const pickupZone = makeZone();
  const destinationZone = makeZone({ id: "b1a60c28-92e6-4f87-b2a4-6f5e8f3d11bb", name: "Mohakhali" });
  return {
    id: "e1a2b3c4-0000-0000-0000-000000000001",
    status: "REQUESTED",
    pickupZone,
    destinationZone,
    requestedSeats: 1,
    fare: makeFare(),
    pool: null,
    createdAt: "2026-09-27T10:00:00.000Z",
    updatedAt: "2026-09-27T10:00:00.000Z",
    ...overrides,
  };
}

export function makeDriverMember(
  overrides: Partial<DriverPoolMemberView> = {},
): DriverPoolMemberView {
  return {
    rideRequestId: "e1a2b3c4-0000-0000-0000-000000000001",
    passengerId: NUSRAT_ID,
    passengerName: "Nusrat Haque",
    pickupZoneId: "b1a60c28-92e6-4f87-b2a4-6f5e8f3d11aa",
    pickupZoneName: "Banani",
    destinationZoneId: "b1a60c28-92e6-4f87-b2a4-6f5e8f3d11bb",
    destinationZoneName: "Mohakhali",
    seats: 1,
    ...overrides,
  };
}

export function makeDriverPool(
  overrides: Partial<DriverPoolView> = {},
): DriverPoolView {
  const member = makeDriverMember();
  return {
    id: "d1f9d4a0-0000-0000-0000-000000000001",
    status: "MATCHED",
    capacitySnapshot: 3,
    occupiedSeats: 1,
    vehicle: { id: BULLET_ID, name: "Bullet", capacity: 3, isOnline: true },
    acceptedAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: "2026-09-27T10:00:00.000Z",
    updatedAt: "2026-09-27T10:00:00.000Z",
    members: [member],
    ...overrides,
  };
}