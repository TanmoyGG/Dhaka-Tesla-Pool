// Unit tests for the deterministic matching rule (Phase 5, ADR-016).
// Pure functions — no database — so the rule itself is pinned independently:
// same pickup zone, all-pairs drop-off spread <= POOL_DEST_SPREAD_KM, then
// the deterministic pool choice (fullest first, created_at ASC, id ASC).
//
// Geometry uses the canonical seed coordinates (docs/database.md §2.4) for the
// story's overlapping routes:
//   Banani -> Mohakhali (Nusrat)  and  Banani -> Gulshan 1 (Rafiq)   -> spread
//   1.906 km -> MATCH,
//   Banani -> Dhanmondi vs Banani -> Mohakhali -> spread 4.585 km -> NO MATCH.

import { describe, expect, it } from "vitest";
import { SEED_ZONES, SEED_ZONE_IDS } from "../src/db/seed.js";
import {
  POOL_DEST_SPREAD_KM,
  dropOffSpreadKm,
  pickBestPool,
  poolAcceptsCandidate,
  type CandidatePool,
  type DropOffCandidate,
} from "../src/matching/rules.js";

// Zone points come from the seed itself so the geometry never drifts from the
// live geography.
const POINTS = Object.fromEntries(
  SEED_ZONES.map((z) => [
    z.name,
    { latitude: z.latitude, longitude: z.longitude },
  ]),
);

function candidate(
  overrides: Partial<DropOffCandidate> = {},
): DropOffCandidate {
  return {
    pickupZoneId: SEED_ZONE_IDS.banani,
    destinationZoneId: SEED_ZONE_IDS.mohakhali,
    destinationPoint: POINTS["Mohakhali"]!,
    requestedSeats: 1,
    ...overrides,
  };
}

function pool(
  id: string,
  overrides: Partial<CandidatePool> = {},
): CandidatePool {
  return {
    id,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    capacitySnapshot: 3,
    occupiedSeats: 1,
    pickupZoneId: SEED_ZONE_IDS.banani,
    destinationPoints: [POINTS["Gulshan 1"]!],
    ...overrides,
  };
}

describe("POOL_DEST_SPREAD_KM rule", () => {
  it("keeps the seeded threshold at 2.0 km (freezes the matching rule)", () => {
    // The constant lives in the source, not just a test value: changing the
    // rule means changing the constant and deliberately updating this pin.
    expect(POOL_DEST_SPREAD_KM).toBe(2.0);
  });

  it("rejects a pool whose ACTIVE drop-offs are too far apart", () => {
    // Spread among any pair in the pool has to fit under the threshold; a
    // single far destination is enough to reject the whole pool.
    const spread = dropOffSpreadKm([
      POINTS["Mohakhali"]!,
      POINTS["Dhanmondi"]!,
    ]);
    expect(spread).toBeGreaterThan(2.0);
    expect(
      poolAcceptsCandidate({
        pool: pool("p1", { destinationPoints: [POINTS["Dhanmondi"]!] }),
        candidate: candidate(),
      }),
    ).toBe(false);
  });

  it("allows the canonical Nusrat + Rafiq overlap (1.906 km spread)", () => {
    const spread = dropOffSpreadKm([
      POINTS["Mohakhali"]!,
      POINTS["Gulshan 1"]!,
    ]);
    expect(spread).toBeLessThanOrEqual(POOL_DEST_SPREAD_KM);
  });

  it("rejects a different pickup zone even with a matching destination", () => {
    expect(
      poolAcceptsCandidate({
        pool: pool("p1"),
        candidate: candidate({ pickupZoneId: SEED_ZONE_IDS.uttara }),
      }),
    ).toBe(false);
  });

  it("rejects a pool that is already at capacity", () => {
    expect(
      poolAcceptsCandidate({
        pool: pool("p1", {
          capacitySnapshot: 3,
          occupiedSeats: 3,
        }),
        candidate: candidate(),
      }),
    ).toBe(false);
  });

  it("counts the candidate's requested seats against remaining capacity", () => {
    // One seat left; a 2-seat request must be rejected.
    expect(
      poolAcceptsCandidate({
        pool: pool("p1", { capacitySnapshot: 3, occupiedSeats: 2 }),
        candidate: candidate({ requestedSeats: 2 }),
      }),
    ).toBe(false);
    expect(
      poolAcceptsCandidate({
        pool: pool("p1", { capacitySnapshot: 3, occupiedSeats: 2 }),
        candidate: candidate({ requestedSeats: 1 }),
      }),
    ).toBe(true);
  });

  it("treats an empty drop-off set as a zero spread (new pool)", () => {
    expect(dropOffSpreadKm([])).toBe(0);
    expect(dropOffSpreadKm([POINTS["Mohakhali"]!])).toBe(0);
  });
});

describe("pickBestPool determinism", () => {
  const basePools = [
    pool("p-full", { id: "p-full", occupiedSeats: 2 }),
    pool("p-old", { id: "p-old", occupiedSeats: 1 }),
    pool("p-far", {
      id: "p-far",
      occupiedSeats: 3,
      destinationPoints: [POINTS["Dhanmondi"]!],
    }),
  ];

  it("picks the fullest eligible pool (never a far one)", () => {
    // p-full (2 seats) beats p-old (1 seat); p-far (3 seats) is ineligible
    // because Dhanmondi is outside the drop-off spread.
    expect(pickBestPool(basePools, candidate())?.id).toBe("p-full");
  });

  it("ties break on earliest created_at, then lexicographic id", () => {
    const twins = [
      pool("p-twin-b", { createdAt: new Date("2026-01-02T00:00:00.000Z") }),
      pool("p-twin-a", { createdAt: new Date("2026-01-01T00:00:00.000Z") }),
      pool("p-twin-c", { createdAt: new Date("2026-01-01T00:00:00.000Z") }),
    ];
    expect(pickBestPool(twins, candidate())?.id).toBe("p-twin-a");
  });

  it("returns null when nothing is eligible", () => {
    expect(pickBestPool([], candidate())).toBeNull();
    expect(
      pickBestPool(
        [
          pool("p1", {
            occupiedSeats: 3,
            capacitySnapshot: 3,
          }),
        ],
        candidate(),
      ),
    ).toBeNull();
  });
});