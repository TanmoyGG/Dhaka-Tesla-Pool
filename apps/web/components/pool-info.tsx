import type { RidePoolView } from "@/lib/types";

export function PoolInfo({ pool }: { pool: RidePoolView | null }) {
  if (!pool) {
    return (
      <p className="text-muted">
        Looking for a pool… This ride request has not been matched yet.
      </p>
    );
  }

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
          {pool.occupiedSeats} / {pool.capacitySnapshot} filled
        </dd>
      </div>
    </dl>
  );
}