"use client";

import { AvailabilityToggle } from "@/components/driver/availability-toggle";
import { LobbyPoolCard } from "@/components/driver/lobby-pool-card";
import { DriverPoolCard } from "@/components/driver/pool-card";
import { RoleGate } from "@/components/role-gate";
import { EmptyState, ErrorCard, LoadingState } from "@/components/state-components";
import {
  useAvailablePools,
  useDriverAvailability,
  useDriverHistory,
  useDriverPools,
} from "@/lib/queries";

// Driver dashboard: availability switch, waiting ride requests in the lobby
// (ADR-022 — claim one first-wins), owned open pools (polled while any is
// non-terminal), and completed-trip history. A PASSENGER reaching this page is
// redirected to /rides by RoleGate; the backend still enforces the role.
export default function DriverDashboardPage() {
  const pools = useDriverPools();
  const lobby = useAvailablePools();
  const history = useDriverHistory();
  const availability = useDriverAvailability();
  const isOffline =
    !availability.isLoading &&
    !availability.isError &&
    availability.data?.isOnline === false;

  return (
    <RoleGate roles={["DRIVER"]} fallback="/rides">
      <main className="container">
        <h1 className="page-header">Driver hub</h1>

        <section aria-labelledby="availability-heading">
          <h2 id="availability-heading">Availability</h2>
          <AvailabilityToggle />
        </section>

        <section aria-labelledby="lobby-heading">
          <h2 id="lobby-heading">Waiting requests</h2>
          <p className="text-muted text-small">
            Ride requests matched to a new pool wait here until a driver claims
            them first-wins. Once claimed they move to your open pools.
          </p>
          {availability.isLoading && (
            <LoadingState label="Loading availability…" />
          )}
          {isOffline && (
            <div className="notice notice-warning" role="status">
              <p>
                You&apos;re offline. Go online in your dashboard to accept
                waiting ride requests.
              </p>
            </div>
          )}
          {!availability.isLoading && !isOffline && (
            <>
              {lobby.isLoading && <LoadingState label="Loading waiting requests…" />}
              {lobby.isError && <ErrorCard error={lobby.error} />}
              {lobby.data && lobby.data.length === 0 && (
                <EmptyState message="No waiting requests right now. New requests that cannot join an existing pool appear here." />
              )}
              {lobby.data && lobby.data.length > 0 && (
                <ul className="ridelist">
                  {lobby.data.map((pool) => (
                    <li key={pool.id}>
                      <LobbyPoolCard pool={pool} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section aria-labelledby="active-heading">
          <h2 id="active-heading">Your open pools</h2>
          {pools.isLoading && <LoadingState label="Loading pools…" />}
          {pools.isError && <ErrorCard error={pools.error} />}
          {pools.data && pools.data.length === 0 && (
            <EmptyState message="No open pools yet. Claim a waiting request above to start one." />
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