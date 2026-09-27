"use client";

import { RideHistory } from "@/components/ride-history";
import { RoleGate } from "@/components/role-gate";

// Passenger ride history — reached from the header menu (docs/frontend-design.md
// §5.5 / §7). Same middleware protection as /rides (the /rides(.*) matcher);
// RoleGate keeps the driver flow on /driver/history.
export default function RidesHistoryPage() {
  return (
    <RoleGate roles={["PASSENGER"]} fallback="/driver">
      <main className="container">
        <h1 className="page-header">Ride history</h1>
        <RideHistory />
      </main>
    </RoleGate>
  );
}