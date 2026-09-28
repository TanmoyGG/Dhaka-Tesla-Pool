"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ActivePoolCard } from "@/components/driver/active-pool-card";
import { AvailabilityToggle } from "@/components/driver/availability-toggle";
import { DriverCompletionModal } from "@/components/driver/driver-completion-modal";
import { LobbyPoolCard } from "@/components/driver/lobby-pool-card";
import { RoleGate } from "@/components/role-gate";
import { EmptyState, ErrorCard, LoadingState } from "@/components/state-components";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  useAvailablePools,
  useDriverAvailability,
  useDriverPools,
} from "@/lib/queries";
import { isTerminal, type DriverPoolView } from "@/lib/types";

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

// Driver workspace (frontend-design.md §6): availability switch, the ONE owned
// pool the driver is running (whose route lights up the map — shared pickup
// plus every distinct member destination), and — when no trip is active — the
// waiting-request lobby (claim unassigned pools first-wins via ADR-022)
// plus the open-pools empty state. Completed-trip history lives behind the
// header menu on /driver/history. A PASSENGER reaching this page is
// redirected to /rides by RoleGate; the backend still enforces the role.
export default function DriverDashboardPage() {
  const pools = useDriverPools();
  const lobby = useAvailablePools();
  const availability = useDriverAvailability();
  const [completedPool, setCompletedPool] = useState<DriverPoolView | null>(
    null,
  );

  // The active pool: the one non-terminal pool the driver owns (the API lists
  // non-terminal only, so this is normally the first — the find is defensive).
  const activePool =
    pools.data?.find((pool) => !isTerminal(pool.status)) ?? null;

  // Map selection: highlight the active pool's shared pickup zone and every
  // distinct member destination (dropping Nusrat at Mohakhali and Rafiq at
  // Gulshan 1 shows BOTH pins). No selection while idle — the lobby's many
  // candidates stay text-only on their cards (frontend-design.md §8).
  const pickupZoneId = activePool?.members[0]?.pickupZoneId;
  const destinationZoneIds = activePool
    ? [...new Set(activePool.members.map((member) => member.destinationZoneId))]
    : undefined;

  const isOffline =
    !availability.isLoading &&
    !availability.isError &&
    availability.data?.isOnline === false;

  return (
    <RoleGate roles={["DRIVER"]} fallback="/rides">
      <WorkspaceShell
        map={
          <MapPane
            pickupZoneId={pickupZoneId}
            destinationZoneIds={destinationZoneIds}
          />
        }
      >
        <h1 className="page-header">Driver workspace</h1>

        <section aria-labelledby="availability-heading">
          <h2 id="availability-heading">Availability</h2>
          <AvailabilityToggle />
        </section>

        {availability.isLoading && <LoadingState label="Loading availability…" />}

        {!availability.isLoading && pools.isLoading && (
          <LoadingState label="Loading open pools…" />
        )}

        {!availability.isLoading && pools.isError && (
          <ErrorCard error={pools.error} />
        )}

        {!availability.isLoading && pools.data && activePool && (
          <div>
            <ActivePoolCard pool={activePool} onCompleted={setCompletedPool} />
            <p className="text-small text-muted">
              Only one pool can stay active at a time. Follow it live, or use
              the trip actions above to move it along — waiting requests pause
              until it lands.
            </p>
          </div>
        )}

        {!availability.isLoading && pools.data && !activePool && (
          <>
            {isOffline && (
              <div className="notice notice-warning" role="status">
                <p>
                  You&apos;re offline. Go online in your dashboard to accept
                  waiting ride requests.
                </p>
              </div>
            )}

            {!isOffline && (
              <section aria-labelledby="lobby-heading">
                <h2 id="lobby-heading">Waiting requests</h2>
                <p className="text-muted text-small">
                  Ride requests matched to a new pool wait here until a driver
                  claims them first-wins. Once claimed they become your active
                  trip.
                </p>
                {lobby.isLoading && (
                  <LoadingState label="Loading waiting requests…" />
                )}
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
              </section>
            )}

            <section aria-labelledby="open-pools-heading">
              <h2 id="open-pools-heading">Your open pools</h2>
              <EmptyState message="No open pools yet. Claim a waiting request above to start one." />
            </section>
          </>
        )}
      </WorkspaceShell>

      <DriverCompletionModal pool={completedPool} />
    </RoleGate>
  );
}