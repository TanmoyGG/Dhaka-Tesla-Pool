import type { RidePoolView } from "@/lib/types";

// Passenger-facing pool status: driver, Tesla, and how full the ride is.
// No fares on this surface (per-passenger fares stay passenger-side).
export function PoolInfo({ pool }: { pool: RidePoolView | null }) {
  if (!pool) {
    return (
      <p className="text-muted">
        Looking for a pool… This ride request has not been matched yet. It
        stays active until another passenger joins or the driver picks it up.
      </p>
    );
  }

  const isShared = pool.occupiedSeats > 1;
  const fill = Math.round((pool.occupiedSeats / pool.capacitySnapshot) * 100);

  return (
    <dl className="dl">
      <div>
        <dt>Driver</dt>
        <dd>{pool.driverName}</dd>
      </div>
      <div>
        <dt>Tesla</dt>
        <dd>{pool.vehicleName}</dd>
      </div>
      <div>
        <dt>Seats</dt>
        <dd>
          {pool.occupiedSeats} of {pool.capacitySnapshot} filled ({fill}%)
        </dd>
      </div>
      {isShared && (
        <div>
          <dt>Shared ride</dt>
          <dd className="text-ok">Yes — 25% pool discount applied</dd>
        </div>
      )}
    </dl>
  );
}