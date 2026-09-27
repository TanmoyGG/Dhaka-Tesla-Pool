"use client";

import { useState } from "react";
import Link from "next/link";
import { BookingArea } from "@/components/booking-area";
import { FareBreakdown } from "@/components/fare-breakdown";
import { PoolInfo } from "@/components/pool-info";
import { RideCard } from "@/components/ride-card";
import { RoleGate } from "@/components/role-gate";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, ErrorCard, LoadingState } from "@/components/state-components";
import { formatPaisa } from "@/lib/format";
import { useRides } from "@/lib/queries";
import { isTerminal, type RideView } from "@/lib/types";

// Passenger landing: book while no ride is active (BookingArea enforces the
// one-active-ride rule in the UI), see the confirmed booking with its live
// pool, and browse ride history. The list and details poll on 5s while any
// ride is still changing and stop once everything is terminal.
export default function RidesPage() {
  const rides = useRides();
  const [booked, setBooked] = useState<RideView | null>(null);

  const activeRide = rides.data?.find((ride) => !isTerminal(ride.status)) ?? null;

  return (
    <RoleGate roles={["PASSENGER"]} fallback="/driver">
      <main className="container">
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

        <section aria-labelledby="history-heading">
          <h2 id="history-heading">Ride history</h2>
          {rides.isLoading && <LoadingState label="Loading rides…" />}
          {rides.isError && <ErrorCard error={rides.error} />}
          {rides.data && rides.data.length === 0 && (
            <EmptyState message="No rides yet — book your first one above." />
          )}
          {rides.data && rides.data.length > 0 && (
            <ul className="ridelist">
              {rides.data.map((ride) => (
                <li key={ride.id}>
                  <RideCard ride={ride} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </RoleGate>
  );
}