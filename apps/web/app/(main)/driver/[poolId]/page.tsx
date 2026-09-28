"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { DriverCompletionModal } from "@/components/driver/driver-completion-modal";
import { MemberList } from "@/components/driver/member-list";
import { PoolActions } from "@/components/driver/pool-actions";
import { RoleGate } from "@/components/role-gate";
import { StatusBadge } from "@/components/status-badge";
import { ErrorCard, LoadingState } from "@/components/state-components";
import { StatusTimeline } from "@/components/status-timeline";
import { formatDateTime, formatPaisa } from "@/lib/format";
import { useDriverPool } from "@/lib/queries";

// One pool for the driver: the trip status, who is on board (ACTIVE members
// with their per-passenger fares), the total the driver collects (pool
// `earnings` — both rendered verbatim from the API, never recomputed here),
// and the single legal next action. Polls on 5s while non-terminal; once
// COMPLETED the cached final view drives the cash-received modal.
export default function DriverPoolDetailPage() {
  const params = useParams<{ poolId: string }>();
  const pool = useDriverPool(params.poolId);

  return (
    <RoleGate roles={["DRIVER"]} fallback="/rides">
      <main className="container">
        <div className="page-head">
          <h1 className="page-header">Pool details</h1>
          <Link className="btn btn-ghost btn-sm" href="/driver">
            ← Back to driver workspace
          </Link>
        </div>

        {pool.isLoading && <LoadingState label="Loading pool…" />}
        {pool.isError && <ErrorCard error={pool.error} />}

        {pool.data && (() => {
          const current = pool.data!;
          const pickup = current.members[0]?.pickupZoneName ?? "—";
          const destinations = [
            ...new Set(current.members.map((member) => member.destinationZoneName)),
          ].join(" → ");
          return (
            <article className="card">
              <div className="row space-between">
                <h2>
                  {pickup} → {destinations}
                </h2>
                <StatusBadge status={current.status} />
              </div>

              <dl className="dl">
                <div>
                  <dt>Tesla</dt>
                  <dd>{current.vehicle?.name ?? "No Tesla assigned"}</dd>
                </div>
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
                  <dd>{current.vehicle ? (current.vehicle.isOnline ? "yes" : "no") : "—"}</dd>
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

              <dl className="dl">
                <div className="total">
                  <dt>Total collection</dt>
                  <dd>{formatPaisa(current.earnings.totalCollectedPaisa)}</dd>
                </div>
              </dl>

              <PoolActions pool={current} />
            </article>
          );
        })()}

        <DriverCompletionModal
          pool={pool.data?.status === "COMPLETED" ? pool.data : null}
        />
      </main>
    </RoleGate>
  );
}