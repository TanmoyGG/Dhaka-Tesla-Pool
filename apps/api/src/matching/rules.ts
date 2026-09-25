// Deterministic pool-matching rules (Phase 5). Pure functions — no I/O, no
// randomness — so the documented matching rule (docs/requirements.md §21.A,
// ADR-016) is independently unit-testable without a database.
//
// Rule (frozen in the Phase 5 plan):
//   1. Same pickup zone.
//   2. All-pairs drop-off spread <= POOL_DEST_SPREAD_KM (haversine kilometres)
//      across the candidate ride plus every ACTIVE member of the pool.
//   3. The pool has enough remaining capacity for the candidate's seats.
//
// Pool choice among the eligible candidates is fully deterministic:
//   fullest first (occupied DESC), then created_at ASC, then id ASC.
// The same rule decides "join an existing pool" vs. "create a new pool": an
// existing eligible pool ALWAYS wins over creating a new one.

import { haversineKm, type ZonePoint } from "../fare/calculate.js";

// Maximum all-pairs straight-line distance between drop-off points for two
// rides to share a Tesla. Chosen so Nusrat (Banani → Mohakhali) and Rafiq
// (Banani → Gulshan 1) match (1.906 km) while a far drop-off like Dhanmondi
// (4.585 km from Mohakhali) does not. Configurable later via the environment.
export const POOL_DEST_SPREAD_KM = 2.0;

export interface DropOffCandidate {
  // Pickup/destination zone ids are compared as opaque identifiers; the
  // coordinates only enter through destinationPoint (for the spread).
  pickupZoneId: string;
  destinationZoneId: string;
  destinationPoint: ZonePoint;
  requestedSeats: number;
}

export interface CandidatePool {
  id: string;
  createdAt: Date;
  capacitySnapshot: number;
  // Derived occupancy: SUM(seats) over ACTIVE members (no cached counter).
  occupiedSeats: number;
  // Every ACTIVE member of an existing pool shares one pickup zone by
  // construction (members only ever join from a matching pickup).
  pickupZoneId: string;
  // Destination points of every ACTIVE member (used for the spread check).
  destinationPoints: ZonePoint[];
}

// Maximum pairwise great-circle distance among a set of drop-off points;
// 0 for fewer than two points.
export function dropOffSpreadKm(points: ZonePoint[]): number {
  let max = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i]!;
      const b = points[j]!;
      const d = haversineKm(a, b);
      if (d > max) max = d;
    }
  }
  return max;
}

export interface PoolEligibilityInput {
  candidate: DropOffCandidate;
  pool: CandidatePool;
}

// Pure eligibility + seat check for a candidate against one pool.
export function poolAcceptsCandidate({
  candidate,
  pool,
}: PoolEligibilityInput): boolean {
  if (candidate.pickupZoneId !== pool.pickupZoneId) return false;
  const spread = dropOffSpreadKm([
    ...pool.destinationPoints,
    candidate.destinationPoint,
  ]);
  if (spread > POOL_DEST_SPREAD_KM) return false;
  return pool.occupiedSeats + candidate.requestedSeats <= pool.capacitySnapshot;
}

// Returns the single best eligible pool (deterministic: fullest first, then
// created_at ASC, then id ASC), or null when nothing fits.
export function pickBestPool(
  candidates: CandidatePool[],
  candidate: DropOffCandidate,
): CandidatePool | null {
  const eligible = candidates.filter((pool) =>
    poolAcceptsCandidate({ candidate, pool }),
  );
  if (eligible.length === 0) return null;
  return (
    eligible.sort(
      (a, b) =>
        b.occupiedSeats - a.occupiedSeats ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  );
}