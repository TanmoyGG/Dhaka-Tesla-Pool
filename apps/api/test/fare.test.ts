// Deterministic fare-estimate tests (ADR-015 §C). These pin the exact paisa
// values so the formula can never silently drift. Values were hand-computed
// from the seed zone coordinates (docs/database.md §2.4) with
// radius 6371 km, road factor 1.3, base 3000 paisa, rate 1200 paisa/km.

import { describe, expect, it } from "vitest";
import {
  computeInitialFare,
  haversineKm,
  roundHalfUp,
  type ZonePoint,
} from "../src/fare/calculate.js";
import { SEED_ZONES } from "../src/db/seed.js";

// Coordinates come from the seed itself (docs/database.md §2.4) so the tests
// can never drift from the live geography.
const ZONES: Record<string, ZonePoint> = Object.fromEntries(
  SEED_ZONES.map((z) => [z.name, { latitude: z.latitude, longitude: z.longitude }]),
);

describe("fare estimate (Phase 4)", () => {
  it("computes a plausible great-circle distance Banani -> Mohakhali", () => {
    const km = haversineKm(ZONES["Banani"], ZONES["Mohakhali"]);
    expect(km).toBeGreaterThan(1.8);
    expect(km).toBeLessThan(2.0);
  });

  it("rounds half-up at the paisa", () => {
    expect(roundHalfUp(2931.4)).toBe(2931);
    expect(roundHalfUp(2931.5)).toBe(2932);
    expect(roundHalfUp(2932.499)).toBe(2932);
  });

  // Nusrat: Banani -> Mohakhali (1 seat). Hand-computed expected estimate:
  // distance ~1.879 km, road 2.443 km, charge round(2.443 * 1200) = 2932 paisa,
  // final 3000 + 2932 = 5932 paisa (BDT 59.32). The DECIMAL_BASE-PAISA story
  // value — pinned here and in the integration test.
  it("estimates Nusrat's Banani -> Mohakhali fare at 5932 paisa", () => {
    const fare = computeInitialFare({
      pickup: ZONES["Banani"],
      destination: ZONES["Mohakhali"],
      requestedSeats: 1,
    });
    expect(fare).toEqual({
      currency: "BDT",
      baseFarePaisa: 3000,
      distanceChargePaisa: 2932,
      poolDiscountPaisa: 0,
      finalFarePaisa: 5932,
      perSeatFarePaisa: 5932,
      estimatedTotalPaisa: 5932,
    });
  });

  // Rafiq: Banani -> Gulshan 1 (1 seat). distance ~0.731 km, road 0.950 km,
  // charge round(0.950 * 1200) = 1140 paisa, final 3000 + 1140 = 4140 paisa.
  it("estimates Rafiq's Banani -> Gulshan 1 fare at 4140 paisa", () => {
    const fare = computeInitialFare({
      pickup: ZONES["Banani"],
      destination: ZONES["Gulshan 1"],
      requestedSeats: 1,
    });
    expect(fare.finalFarePaisa).toBe(4140);
    expect(fare.distanceChargePaisa).toBe(1140);
  });

  it("scales the total by requested seats but keeps stored components per seat", () => {
    const single = computeInitialFare({
      pickup: ZONES["Banani"],
      destination: ZONES["Mohakhali"],
      requestedSeats: 1,
    });
    const double = computeInitialFare({
      pickup: ZONES["Banani"],
      destination: ZONES["Mohakhali"],
      requestedSeats: 2,
    });
    // Stored components are per seat (unchanged), the total doubles.
    expect(double.finalFarePaisa).toBe(single.finalFarePaisa);
    expect(double.distanceChargePaisa).toBe(single.distanceChargePaisa);
    expect(double.estimatedTotalPaisa).toBe(single.estimatedTotalPaisa * 2);
    expect(double.estimatedTotalPaisa).toBe(2 * 5932);
  });

  it("always satisfies final = base + distance - discount (DB invariant)", () => {
    for (const [from, to] of [
      ["Banani", "Uttara"],
      ["Mirpur", "Gulshan 1"],
      ["Farmgate", "Bashundhara"],
      ["Dhanmondi", "Uttara"],
    ] as const) {
      const fare = computeInitialFare({
        pickup: ZONES[from],
        destination: ZONES[to],
        requestedSeats: 3,
      });
      expect(fare.finalFarePaisa).toBe(
        fare.baseFarePaisa + fare.distanceChargePaisa - fare.poolDiscountPaisa,
      );
      expect(fare.poolDiscountPaisa).toBe(0);
    }
  });

  it("keeps all money amounts non-negative and integral (paisa)", () => {
    for (const [from, to] of [
      ["Banani", "Bashundhara"],
      ["Uttara", "Dhanmondi"],
    ] as const) {
      const fare = computeInitialFare({
        pickup: ZONES[from],
        destination: ZONES[to],
        requestedSeats: 1,
      });
      expect(Number.isInteger(fare.distanceChargePaisa)).toBe(true);
      expect(fare.distanceChargePaisa).toBeGreaterThan(0);
      expect(fare.finalFarePaisa).toBeGreaterThan(0);
    }
  });
});