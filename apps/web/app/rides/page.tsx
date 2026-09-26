"use client";

import { useState } from "react";
import Link from "next/link";
import { FareBreakdown } from "@/components/fare-breakdown";
import { PoolInfo } from "@/components/pool-info";
import { RideCard } from "@/components/ride-card";
import { RideForm } from "@/components/ride-form";
import { StatusBadge } from "@/components/status-badge";
import { formatPaisa } from "@/lib/format";
import { useRides } from "@/lib/queries";
import type { RideView } from "@/lib/types";

export default function RidesPage() {
  const rides = useRides();
  const [booked, setBooked] = useState<RideView | null>(null);

  return (
    <main>
      <h1>Your rides</h1>
      <p>
        <Link href="/account">Back to account</Link> ·{" "}
        <Link href="/">Home</Link>
      </p>

      <section aria-labelledby="book-heading">
        <h2 id="book-heading">Book a ride</h2>
        <RideForm onBooked={setBooked} />
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
            <Link className="btn btn-secondary" href={`/rides/${booked.id}`}>
              View ride details
            </Link>
          </p>
        </section>
      )}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading">Ride history</h2>
        {rides.isLoading && <p className="text-muted">Loading rides…</p>}
        {rides.isError && (
          <p className="error-text">
            Could not load your rides. Refresh to try again.
          </p>
        )}
        {rides.data && rides.data.length === 0 && (
          <p className="text-muted">No rides yet — book your first one above.</p>
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
  );
}