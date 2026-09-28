import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { formatPaisa } from "@/lib/format";
import { nextPoolAction } from "@/lib/pool-actions";
import type { DriverPoolView } from "@/lib/types";

// One completed trip on the driver's history (frontend-design.md §6.6):
// route, occupancy, passenger count, and the total collected. Fares come
// verbatim from the backend pool view (`earnings.totalCollectedPaisa`) —
// never recomputed. The active-pool variant lives on the workspace as
// ActivePoolCard; this compact card serves the history route.
export function DriverPoolCard({
  pool,
  isHistory = false,
}: {
  pool: DriverPoolView;
  isHistory?: boolean;
}) {
  const next = nextPoolAction(pool);
  const members = pool.members;
  const firstRider = members[0];
  const route = firstRider
    ? `${firstRider.pickupZoneName} → ${firstRider.destinationZoneName}`
    : "No confirmed route";
  const destinationZoneIds = [...new Set(members.map((m) => m.destinationZoneId))];

  return (
    <article className="card">
      <div className="row space-between">
        <h3 className="card-title">{pool.vehicle?.name ?? "Waiting for a driver"}</h3>
        <StatusBadge status={pool.status} />
      </div>

      <p className="card-seats text-muted">
        {route}
        {destinationZoneIds.length > 1
          ? ` (+${destinationZoneIds.length - 1} more drop-off${destinationZoneIds.length === 2 ? "" : "s"})`
          : ""}
      </p>
      <p className="card-seats text-muted">
        {pool.occupiedSeats} of {pool.capacitySnapshot} seats · {members.length}{" "}
        passenger{members.length === 1 ? "" : "s"} · total collected{" "}
        <strong>{formatPaisa(pool.earnings.totalCollectedPaisa)}</strong>
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