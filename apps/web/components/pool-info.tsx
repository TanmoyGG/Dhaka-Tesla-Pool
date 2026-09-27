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

  // A MATCHED pool with no driver/Tesla is an UNASSIGNED wait pool (ADR-022):
  // your request is queued in the driver lobby for any eligible driver to
  // claim first-wins. No driver is assigned yet, so there is no driver or
  // Tesla to show.
  const waitingForDriver = !pool.driverName || !pool.vehicleName;

  const isShared = pool.occupiedSeats > 1;
  const fill = Math.round((pool.occupiedSeats / pool.capacitySnapshot) * 100);

  return (
    <dl className="dl">
      <div>
        <dt>Driver</dt>
        <dd>{waitingForDriver ? "Waiting for a driver…" : pool.driverName}</dd>
      </div>
      <div>
        <dt>Tesla</dt>
        <dd>{waitingForDriver ? "—" : pool.vehicleName}</dd>
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