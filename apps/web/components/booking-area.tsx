"use client";

import Link from "next/link";
import { StatusBadge } from "./status-badge";
import { RideForm } from "./ride-form";
import type { RideView } from "@/lib/types";

// Hard rule mirrored from the backend: one active ride per passenger (partial
// unique index, 409 ACTIVE_RIDE_EXISTS). While a ride is still in flight the
// booking form is replaced by a notice pointing to the live ride. This is the
// single gatecomponent so the rides page and any future entry points behave
// identically.
export function BookingArea({
  activeRide,
  onBooked,
}: {
  activeRide: RideView | null;
  onBooked: (ride: RideView) => void;
}) {
  if (activeRide) {
    return (
      <div className="notice notice-warning" role="status">
        <h3>You have an active ride</h3>
        <p>
          {activeRide.pickupZone.name} → {activeRide.destinationZone.name} ·{" "}
          <StatusBadge status={activeRide.status} />
        </p>
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

  return <RideForm onBooked={onBooked} />;
}