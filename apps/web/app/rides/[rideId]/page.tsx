"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { CancelRideButton } from "@/components/cancel-ride-button";
import { FareBreakdown } from "@/components/fare-breakdown";
import { PoolInfo } from "@/components/pool-info";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, describeApiError } from "@/lib/api";
import { formatPaisa } from "@/lib/format";
import { useRide } from "@/lib/queries";

export default function RideDetailPage() {
  const params = useParams<{ rideId: string }>();
  const ride = useRide(params.rideId);

  if (ride.isLoading) {
    return (
      <main>
        <h1>Ride details</h1>
        <p className="text-muted">Loading ride…</p>
      </main>
    );
  }

  if (ride.isError) {
    const notFound =
      ride.error instanceof ApiError &&
      (ride.error.code === "NOT_FOUND" || ride.error.code === "HTTP_404");
    return (
      <main>
        <h1>Ride details</h1>
        {notFound ? (
          <p className="error-text">
            This ride does not exist, or it belongs to another account.
          </p>
        ) : (
          <p className="error-text">{describeApiError(ride.error)}</p>
        )}
        <p>
          <Link href="/rides">Back to your rides</Link>
        </p>
      </main>
    );
  }

  const current = ride.data!;

  return (
    <main>
      <h1>Ride details</h1>
      <p>
        <Link href="/rides">Back to your rides</Link>
      </p>

      <article className="card">
        <div className="row space-between">
          <h2>
            {current.pickupZone.name} → {current.destinationZone.name}
          </h2>
          <StatusBadge status={current.status} />
        </div>

        <dl className="dl">
          <div>
            <dt>Pickup</dt>
            <dd>{current.pickupZone.name}</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>{current.destinationZone.name}</dd>
          </div>
          <div>
            <dt>Seats</dt>
            <dd>{current.requestedSeats}</dd>
          </div>
          <div>
            <dt>Fare per seat</dt>
            <dd>{formatPaisa(current.fare.perSeatFarePaisa)}</dd>
          </div>
          <div>
            <dt>Estimated total</dt>
            <dd>{formatPaisa(current.fare.estimatedTotalPaisa)}</dd>
          </div>
        </dl>

        <h3>Pool</h3>
        <PoolInfo pool={current.pool} />

        <h3>Fare breakdown</h3>
        <FareBreakdown fare={current.fare} />

        <CancelRideButton rideId={current.id} status={current.status} />
      </article>
    </main>
  );
}