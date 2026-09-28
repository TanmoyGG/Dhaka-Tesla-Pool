"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { BookingArea } from "@/components/booking-area";
import { FareBreakdown } from "@/components/fare-breakdown";
import { PoolInfo } from "@/components/pool-info";
import { RoleGate } from "@/components/role-gate";
import { StatusBadge } from "@/components/status-badge";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { formatPaisa } from "@/lib/format";
import { useRides } from "@/lib/queries";
import { isTerminal, type RideView } from "@/lib/types";

// Leaflet is client-only and must never execute during prerender, so the map
// is always `dynamic(…, { ssr: false })`. The placeholder keeps the map slot's
// size while it loads so the layout doesn't jump (frontend-design.md §8).
const MapPane = dynamic(() => import("@/components/workspace/map-pane"), {
  ssr: false,
  loading: () => (
    <div className="map-pane map-pane-placeholder" role="status">
      Loading map…
    </div>
  ),
});

// Passenger workspace: book while no ride is active (BookingArea enforces the
// one-active-ride rule in the UI) and see the confirmed booking with its live
// pool. Ride history lives behind the header menu on /rides/history
// (docs/frontend-design.md §5.5 / §7), not on this page.
export default function RidesPage() {
  const rides = useRides();
  const [booked, setBooked] = useState<RideView | null>(null);

  const activeRide = rides.data?.find((ride) => !isTerminal(ride.status)) ?? null;

  return (
    <RoleGate roles={["PASSENGER"]} fallback="/driver">
      <WorkspaceShell map={<MapPane />}>
        <h1 className="page-header">Book a ride</h1>

        <section aria-labelledby="book-heading">
          <h2 id="book-heading">Where to?</h2>
          <BookingArea activeRide={activeRide} onBooked={setBooked} />
        </section>

        {booked && (
          <section aria-labelledby="booked-heading" className="card success-banner">
            <h2 id="booked-heading">Booking confirmed</h2>
            <p>
              {booked.pickupZone.name} → {booked.destinationZone.name} ·{" "}
              <StatusBadge status={booked.status} /> · estimated total{" "}
              <strong>{formatPaisa(booked.fare.estimatedTotalPaisa)}</strong>
            </p>
            <PoolInfo pool={booked.pool} />
            <FareBreakdown fare={booked.fare} />
            <p>
              <Link className="btn btn-secondary btn-sm" href={`/rides/${booked.id}`}>
                View ride details
              </Link>
            </p>
          </section>
        )}
      </WorkspaceShell>
    </RoleGate>
  );
}