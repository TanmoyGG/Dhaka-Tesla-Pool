"use client";

import Link from "next/link";
import { PoolActions } from "./pool-actions";
import { StatusBadge } from "@/components/status-badge";
import { formatPaisa } from "@/lib/format";
import type { DriverPoolView } from "@/lib/types";

// The ONE owned pool the driver is running right now (frontend-design.md
// §6.4): the driver's analog of the passenger's active-ride notice. Replaces
// the waiting-request lobby and the open-pools list while a trip is in
// flight — quick glance at the Tesla, fill, and total money to collect, plus
// the single legal next lifecycle action right here (arrive → start →
// complete). Money comes verbatim from the backend pool view; the per-member
// breakdown lives on the pool detail page.
export function ActivePoolCard({
  pool,
  onCompleted,
}: {
  pool: DriverPoolView;
  // Forwarded to PoolActions: the completed pool view when THIS workspace's
  // card finishes the trip feeds the cash-received modal directly.
  onCompleted?: (pool: DriverPoolView) => void;
}) {
  return (
    <div className="notice notice-warning" role="status">
      <h3>Active trip</h3>
      <p>
        {pool.members[0]?.pickupZoneName ?? "—"} →{" "}
        {pool.members[0]?.destinationZoneName ?? "—"} ·{" "}
        <StatusBadge status={pool.status} />
      </p>

      <dl className="dl active-ride-details">
        <div>
          <dt>Tesla</dt>
          <dd>{pool.vehicle?.name ?? "No Tesla assigned"}</dd>
        </div>
        <div>
          <dt>Seats filled</dt>
          <dd>
            {pool.occupiedSeats} of {pool.capacitySnapshot}
          </dd>
        </div>
        <div>
          <dt>Total to collect</dt>
          <dd>{formatPaisa(pool.earnings.totalCollectedPaisa)}</dd>
        </div>
      </dl>

      {/* PoolActions renders a block `<div>`; `<p>` accepts phrasing content
          only, so it must sit in a `<div>` (hydration-safe nesting). */}
      <div className="mt">
        <PoolActions pool={pool} onCompleted={onCompleted} />
      </div>

      <p className="mt">
        <Link className="btn btn-secondary btn-sm" href={`/driver/${pool.id}`}>
          View pool details
        </Link>
      </p>
    </div>
  );
}