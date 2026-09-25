// Pooled-fare recompute (Phase 5, ADR-017). When a ride joins or leaves a
// pool, every ACTIVE member's fare row is recomputed IN PLACE from the current
// pool size:
//
//   discount = pooledDiscountPaisa(base, distance)  if ACTIVE members >= 2
//            = 0                                    otherwise
//   final    = base + distance - discount
//
// Stored components (base, distance) are unchanged — only the discount and the
// derived final are rewritten, with `fares.updated_at` bumped (migration 0004)
// so the recompute is auditable. Membership leaves are handled by the caller:
// occupancy here is always derived from ACTIVE rows only.

import { and, eq } from "drizzle-orm";
import { fares, poolMembers, rideRequests, type pools } from "../../db/schema.js";
import type { DbTransaction } from "../../db/types.js";
import { pooledDiscountPaisa } from "../../fare/calculate.js";
import { POOLED_DISCOUNT_MIN_MEMBERS } from "../../fare/constants.js";

// Injectable seam (tests substitute a throwing recompute to prove that a join
// failure rolls the whole match transaction back).
export type RecomputePoolFares = (
  tx: DbTransaction,
  poolId: string,
) => Promise<void>;

export async function recomputeActivePoolFares(
  tx: DbTransaction,
  poolId: string,
): Promise<void> {
  const members = await tx
    .select({
      fareId: fares.id,
      baseFarePaisa: fares.baseFarePaisa,
      distanceChargePaisa: fares.distanceChargePaisa,
    })
    .from(poolMembers)
    .innerJoin(rideRequests, eq(rideRequests.id, poolMembers.rideRequestId))
    .innerJoin(fares, eq(fares.rideRequestId, rideRequests.id))
    .where(
      and(eq(poolMembers.poolId, poolId), eq(poolMembers.status, "ACTIVE")),
    );

  const activeCount = members.length;
  const now = new Date();
  for (const member of members) {
    const discount =
      activeCount >= POOLED_DISCOUNT_MIN_MEMBERS
        ? pooledDiscountPaisa(member.baseFarePaisa, member.distanceChargePaisa)
        : 0;
    await tx
      .update(fares)
      .set({
        poolDiscountPaisa: discount,
        finalFarePaisa: member.baseFarePaisa + member.distanceChargePaisa - discount,
        updatedAt: now,
      })
      .where(eq(fares.id, member.fareId));
  }
}

// Force-cancel refund (full refund, docs/requirements.md §21.B): the full fare
// is written back as a zero final — base + distance refunded via the discount
// term, which keeps every `fares` CHECK satisfied (final = base + distance −
// discount, all non-negative).
export async function refundFare(tx: DbTransaction, rideRequestId: string): Promise<void> {
  const [fare] = await tx
    .select()
    .from(fares)
    .where(eq(fares.rideRequestId, rideRequestId))
    .limit(1);
  if (!fare) {
    throw new Error(`cannot refund fare: no fare row for ride ${rideRequestId}`);
  }
  await tx
    .update(fares)
    .set({
      poolDiscountPaisa: fare.baseFarePaisa + fare.distanceChargePaisa,
      finalFarePaisa: 0,
      updatedAt: new Date(),
    })
    .where(eq(fares.id, fare.id));
}

// Re-exported for callers that want to operate on a pool's id with the same
// structural type without importing the schema table object.
export type PoolRow = typeof pools.$inferSelect;