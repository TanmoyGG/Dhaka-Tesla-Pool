"use client";

import Link from "next/link";
import { StatusBadge } from "./status-badge";
import { RideForm, type ZoneSelection } from "./ride-form";
import { formatPaisa } from "@/lib/format";
import type { RideView } from "@/lib/types";

// Hard rule mirrored from the backend: one active ride per passenger (partial
// unique index, 409 ACTIVE_RIDE_EXISTS). While a ride is still in flight the
// booking form is replaced by a notice pointing to the live ride. This is the
// single gatecomponent so the rides page and any future entry points behave
// identically. The quick-glance rows reuse the backend-provided pool/fare
// values — no new API surfaces, and no detailed FareBreakdown duplicating the
// ride-details page.
export function BookingArea({
  activeRide,
  onBooked,
  onSelectionChange,
}: {
  activeRide: RideView | null;
  onBooked: (ride: RideView) => void;
  onSelectionChange?: (selection: ZoneSelection) => void;
}) {
  if (activeRide) {
    const pool = activeRide.pool;
    // A matched-but-driverless pool is an UNASSIGNED wait pool (ADR-022):
    // the request is queued in the lobby until a driver claims it first-wins.
    const driverName = pool
      ? pool.driverName ?? "Waiting for a driver…"
      : "Not matched yet";
    const seatsFilled = pool
      ? `${pool.occupiedSeats} of ${pool.capacitySnapshot} filled`
      : "Not matched yet";

    return (
      <div className="notice notice-warning" role="status">
        <h3>You have an active ride</h3>
        <p>
          {activeRide.pickupZone.name} → {activeRide.destinationZone.name} ·{" "}
          <StatusBadge status={activeRide.status} />
        </p>

        <dl className="dl active-ride-details">
          <div>
            <dt>Driver</dt>
            <dd>{driverName}</dd>
          </div>
          <div>
            <dt>Seats filled</dt>
            <dd>{seatsFilled}</dd>
          </div>
          <div>
            <dt>Total fare</dt>
            <dd>{formatPaisa(activeRide.fare.estimatedTotalPaisa)}</dd>
          </div>
        </dl>

        <p className="text-small text-muted">
          Only one ride can stay active at a time. Follow it live, or cancel
          it once it&apos;s still cancellable — then you can book another.
        </p>
        <p className="mt">
          <Link className="btn btn-secondary btn-sm" href={`/rides/${activeRide.id}`}>
            View active ride
          </Link>
        </p>
      </div>
    );
  }

  return <RideForm onBooked={onBooked} onSelectionChange={onSelectionChange} />;
}