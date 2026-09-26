import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { nextPoolAction } from "@/lib/pool-actions";
import type { DriverPoolView } from "@/lib/types";

// One pool on the driver dashboard: Tesla, occupancy, how many passengers
// are on board, and the legal next action. Fares stay off this surface (P9).
export function DriverPoolCard({
  pool,
  isHistory = false,
}: {
  pool: DriverPoolView;
  isHistory?: boolean;
}) {
  const next = nextPoolAction(pool);
  const passengers = pool.members.length;

  return (
    <article className="card">
      <div className="row space-between">
        <h3 className="card-title">{pool.vehicle.name}</h3>
        <StatusBadge status={pool.status} />
      </div>

      <p className="card-seats text-muted">
        {pool.occupiedSeats} of {pool.capacitySnapshot} seats ·{" "}
        {passengers} passenger{passengers === 1 ? "" : "s"}
      </p>

      {!isHistory && next && (
        <p className="text-small text-muted">Next: {next.label.toLowerCase()}</p>
      )}

      <div className="row space-between mt">
        <Link className="btn btn-secondary btn-sm" href={`/driver/${pool.id}`}>
          {isHistory ? "Trip summary" : "Open pool"}
        </Link>
      </div>
    </article>
  );
}