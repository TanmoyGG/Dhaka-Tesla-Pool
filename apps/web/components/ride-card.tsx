import Link from "next/link";
import { formatPaisa } from "@/lib/format";
import type { RideView } from "@/lib/types";
import { CancelRideButton } from "./cancel-ride-button";
import { StatusBadge } from "./status-badge";

export function RideCard({ ride }: { ride: RideView }) {
  return (
    <article className="card">
      <div className="row space-between">
        <h3 className="card-title">
          {ride.pickupZone.name} → {ride.destinationZone.name}
        </h3>
        <StatusBadge status={ride.status} />
      </div>

      <p className="card-seats text-muted">
        {ride.requestedSeats} seat{ride.requestedSeats === 1 ? "" : "s"} ·{" "}
        {ride.pool
          ? `${ride.pool.occupiedSeats}/${ride.pool.capacitySnapshot} seats filled`
          : "not matched yet"}
      </p>

      <div className="row space-between">
        <p className="card-fare">
          {formatPaisa(ride.fare.perSeatFarePaisa)}/seat · total{" "}
          <strong>{formatPaisa(ride.fare.estimatedTotalPaisa)}</strong>
        </p>
        <Link className="btn btn-secondary" href={`/rides/${ride.id}`}>
          Details
        </Link>
      </div>

      <CancelRideButton rideId={ride.id} status={ride.status} />
    </article>
  );
}