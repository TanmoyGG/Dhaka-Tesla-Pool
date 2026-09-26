"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { MemberList } from "@/components/driver/member-list";
import { PoolActions } from "@/components/driver/pool-actions";
import { RoleGate } from "@/components/role-gate";
import { StatusBadge } from "@/components/status-badge";
import { ErrorCard, LoadingState } from "@/components/state-components";
import { StatusTimeline } from "@/components/status-timeline";
import { formatDateTime } from "@/lib/format";
import { useDriverPool } from "@/lib/queries";

// One pool for the driver: the trip status, who is on board (ACTIVE members,
// no fares), and the single legal next action. Polls on 5s while non-terminal.
export default function DriverPoolDetailPage() {
  const params = useParams<{ poolId: string }>();
  const pool = useDriverPool(params.poolId);

  return (
    <RoleGate roles={["DRIVER"]} fallback="/rides">
      <main className="container">
        <p className="page-link">
          <Link href="/driver">Back to driver hub</Link>
        </p>

        <h1 className="page-header">Pool</h1>

        {pool.isLoading && <LoadingState label="Loading pool…" />}
        {pool.isError && <ErrorCard error={pool.error} />}

        {pool.data && (() => {
          const current = pool.data!;
          return (
            <article className="card">
              <div className="row space-between">
                <h2>{current.vehicle.name}</h2>
                <StatusBadge status={current.status} />
              </div>

              <dl className="dl">
                <div>
                  <dt>Status</dt>
                  <dd>{current.status}</dd>
                </div>
                <div>
                  <dt>Seats</dt>
                  <dd>
                    {current.occupiedSeats} of {current.capacitySnapshot} filled
                  </dd>
                </div>
                <div>
                  <dt>Vehicle online</dt>
                  <dd>{current.vehicle.isOnline ? "yes" : "no"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDateTime(current.createdAt)}</dd>
                </div>
                {current.acceptedAt && (
                  <div>
                    <dt>Accepted</dt>
                    <dd>{formatDateTime(current.acceptedAt)}</dd>
                  </div>
                )}
                {current.startedAt && (
                  <div>
                    <dt>Started</dt>
                    <dd>{formatDateTime(current.startedAt)}</dd>
                  </div>
                )}
                {current.completedAt && (
                  <div>
                    <dt>Completed</dt>
                    <dd>{formatDateTime(current.completedAt)}</dd>
                  </div>
                )}
              </dl>

              <h3>Status</h3>
              <StatusTimeline status={current.status} updatedAt={current.updatedAt} />

              <h3>Passengers</h3>
              <MemberList members={current.members} />

              <PoolActions pool={current} />
            </article>
          );
        })()}
      </main>
    </RoleGate>
  );
}