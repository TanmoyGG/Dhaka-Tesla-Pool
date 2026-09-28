import { formatPaisa } from "@/lib/format";
import type { DriverPoolMemberView } from "@/lib/types";

// Passengers physically on board this trip (ACTIVE members only). Names,
// seats, zones, and the fare this passenger pays (backend `member.fare`,
// rendered verbatim — never recomputed here). The collection total is the
// pool's `earnings` field, shown beside the list.
export function MemberList({ members }: { members: DriverPoolMemberView[] }) {
  if (members.length === 0) {
    return <p className="text-muted">No passengers confirmed on this trip.</p>;
  }

  return (
    <ul className="memberlist">
      {members.map((member) => (
        <li key={member.rideRequestId}>
          <span className="member-name">{member.passengerName}</span>
          <span className="member-route text-muted">
            {" "}
            · {member.seats} seat{member.seats === 1 ? "" : "s"} ·{" "}
            {member.pickupZoneName} → {member.destinationZoneName}
          </span>
          <span className="member-fare">
            {" "}
            · {formatPaisa(member.fare.totalPaisa)}
          </span>
        </li>
      ))}
    </ul>
  );
}