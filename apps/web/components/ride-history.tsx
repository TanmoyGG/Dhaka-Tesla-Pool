"use client";

import { RideCard } from "./ride-card";
import { useRides } from "@/lib/queries";
import { EmptyState, ErrorCard, LoadingState } from "./state-components";

// Passenger ride history (docs/frontend-design.md §5.5): the ride list that
// used to sit on the /rides workspace, now on its own menu-driven route. Fed
// by GET /api/rides and rendered with RideCard (details + inline cancel).
export function RideHistory() {
  const rides = useRides();

  return (
    <>
      {rides.isLoading && <LoadingState label="Loading rides…" />}
      {rides.isError && <ErrorCard error={rides.error} />}
      {rides.data && rides.data.length === 0 && (
        <EmptyState message="No rides yet — book your first one from the menu." />
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
    </>
  );
}