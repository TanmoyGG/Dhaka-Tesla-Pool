"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { CancelRideButton } from "@/components/cancel-ride-button";
import { FareBreakdown } from "@/components/fare-breakdown";
import { PoolInfo } from "@/components/pool-info";
import { RoleGate } from "@/components/role-gate";
import { StatusBadge } from "@/components/status-badge";
import { ErrorCard, LoadingState } from "@/components/state-components";
import { StatusTimeline } from "@/components/status-timeline";
import { formatDateTime, formatPaisa } from "@/lib/format";
import { useRide } from "@/lib/queries";

// Live ride detail. Polls on 5s while the ride is non-terminal and stops the
// moment it settles (COMPLETED/CANCELLED); the whole status chain comes from
// the single backend-enforced state machine.
export default function RideDetailPage() {
  const params = useParams<{ rideId: string }>();
  const ride = useRide(params.rideId);

  return (
    <RoleGate roles={["PASSENGER"]} fallback="/driver">
      <main className="container">
        <h1 className="page-header">Ride details</h1>

        {ride.isLoading && <LoadingState label="Loading ride…" />}
        {ride.isError && <ErrorCard error={ride.error} />}

        {ride.data && (() => {
          const current = ride.data!;
          return (
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
                  <dt>Requested</dt>
                  <dd>{formatDateTime(current.createdAt)}</dd>
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

              <h3>Status</h3>
              <StatusTimeline status={current.status} updatedAt={current.updatedAt} />

              <h3>Pool</h3>
              <PoolInfo pool={current.pool} />

              <h3>Fare breakdown</h3>
              <FareBreakdown fare={current.fare} />

              <CancelRideButton rideId={current.id} status={current.status} />
            </article>
          );
        })()}

        {ride.data && (
          <p>
            <Link href="/rides">Back to your rides</Link>
          </p>
        )}
      </main>
    </RoleGate>
  );
}