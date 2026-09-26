"use client";

import { AvailabilityToggle } from "@/components/driver/availability-toggle";
import { DriverPoolCard } from "@/components/driver/pool-card";
import { RoleGate } from "@/components/role-gate";
import { EmptyState, ErrorCard, LoadingState } from "@/components/state-components";
import { useDriverHistory, useDriverPools } from "@/lib/queries";

// Driver dashboard: availability switch, open pools (polled while any is
// non-terminal), and completed-trip history. A PASSENGER reaching this page is
// redirected to /rides by RoleGate; the backend still enforces the role.
export default function DriverDashboardPage() {
  const pools = useDriverPools();
  const history = useDriverHistory();

  return (
    <RoleGate roles={["DRIVER"]} fallback="/rides">
      <main className="container">
        <h1 className="page-header">Driver hub</h1>

        <section aria-labelledby="availability-heading">
          <h2 id="availability-heading">Availability</h2>
          <AvailabilityToggle />
        </section>

        <section aria-labelledby="active-heading">
          <h2 id="active-heading">Open pools</h2>
          {pools.isLoading && <LoadingState label="Loading pools…" />}
          {pools.isError && <ErrorCard error={pools.error} />}
          {pools.data && pools.data.length === 0 && (
            <EmptyState message="No open pools. Stay online — new ride requests are matched to you automatically." />
          )}
          {pools.data && pools.data.length > 0 && (
            <ul className="ridelist">
              {pools.data.map((pool) => (
                <li key={pool.id}>
                  <DriverPoolCard pool={pool} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="history-heading">
          <h2 id="history-heading">Completed trips</h2>
          {history.isLoading && <LoadingState label="Loading history…" />}
          {history.isError && <ErrorCard error={history.error} />}
          {history.data && history.data.length === 0 && (
            <EmptyState message="No completed trips yet." />
          )}
          {history.data && history.data.length > 0 && (
            <ul className="ridelist">
              {history.data.map((pool) => (
                <li key={pool.id}>
                  <DriverPoolCard pool={pool} isHistory />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </RoleGate>
  );
}