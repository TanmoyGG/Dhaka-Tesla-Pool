"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { BookingArea } from "@/components/booking-area";
import { FareBreakdown } from "@/components/fare-breakdown";
import { PoolInfo } from "@/components/pool-info";
import { RideCompletionModal } from "@/components/ride-completion-modal";
import { RoleGate } from "@/components/role-gate";
import { StatusBadge } from "@/components/status-badge";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { ZoneSelection } from "@/components/ride-form";
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
// pool. The form lifts its zone selection up so the map can highlight the
// pickup/destination pins (Phase 4, §8), and that highlight is kept while the
// booked ride is active so the passenger can see their route live. Ride
// history lives behind the header menu on /rides/history (docs/frontend-design.md
// §5.5 / §7), not on this page.
export default function RidesPage() {
  const rides = useRides();
  const [booked, setBooked] = useState<RideView | null>(null);
  const [selection, setSelection] = useState<ZoneSelection>({});
  const [completedRide, setCompletedRide] = useState<RideView | null>(null);

  const activeRide = rides.data?.find((ride) => !isTerminal(ride.status)) ?? null;

  // Map selection: while a ride is active, highlight THAT ride's pickup and
  // destination (Phase 4) — derived from the active ride itself, so the pins
  // survive booking, the switch to the active-ride notice, and a mid-ride page
  // reload. Otherwise the map mirrors whatever the booking form holds.
  const mapSelection: ZoneSelection = activeRide
    ? {
        pickupZoneId: activeRide.pickupZone.id,
        destinationZoneId: activeRide.destinationZone.id,
      }
    : selection;

  // When the active ride ends the booking form returns — clear the old
  // selection then, so a fresh booking never inherits the previous route.
  const hadActiveRideRef = useRef(false);
  useEffect(() => {
    if (hadActiveRideRef.current && !activeRide) {
      setSelection({});
    }
    hadActiveRideRef.current = Boolean(activeRide);
  }, [activeRide]);

  // Completion modal trigger: the passenger's ACTIVE ride reached COMPLETED —
  // it drops out of `activeRide` (terminal) while staying in the list. Watch
  // the previously-active id; when it later turns up COMPLETED, pass it to the
  // modal (which persists its own acknowledgement so it shows exactly once).
  // Pre-existing COMPLETED rows in history never trigger it (no prior active
  // ride was seen).
  const previousActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeRide) {
      previousActiveIdRef.current = activeRide.id;
      return;
    }
    const previousId = previousActiveIdRef.current;
    if (previousId) {
      previousActiveIdRef.current = null;
      const completed = rides.data?.find(
        (ride) => ride.id === previousId && ride.status === "COMPLETED",
      );
      if (completed) setCompletedRide(completed);
    }
  }, [activeRide, rides.data]);

  function handleBooked(ride: RideView) {
    setBooked(ride);
  }

  return (
    <RoleGate roles={["PASSENGER"]} fallback="/driver">
      <WorkspaceShell
        map={
          <MapPane
            pickupZoneId={mapSelection.pickupZoneId}
            destinationZoneId={mapSelection.destinationZoneId}
          />
        }
      >
        <h1 className="page-header">Book a ride</h1>

        <BookingArea
          activeRide={activeRide}
          onBooked={handleBooked}
          onSelectionChange={setSelection}
        />

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

      <RideCompletionModal ride={completedRide} />
    </RoleGate>
  );
}