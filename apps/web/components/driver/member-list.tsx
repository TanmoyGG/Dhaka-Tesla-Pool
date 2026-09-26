import type { DriverPoolMemberView } from "@/lib/types";

// Passengers physically on board this trip (ACTIVE members only). Names,
// seats, and zones — the driver runs the trip with this; per-passenger fares
// never appear on the driver surface.
export function MemberList({ members }: { members: DriverPoolMemberView[] }) {
  if (members.length === 0) {
    return <p className="text-muted">No passengers confirmed on this trip.</p>;
  }

  return (
    <ul className="memberlist">
      {members.map((member) => (
        <li key={member.rideRequestId}>
          <span className="member-name">{member.passengerName}</span>
          <span className="text-muted">
            {" "}
            · {member.seats} seat{member.seats === 1 ? "" : "s"} ·{" "}
            {member.pickupZoneName} → {member.destinationZoneName}
          </span>
        </li>
      ))}
    </ul>
  );
}