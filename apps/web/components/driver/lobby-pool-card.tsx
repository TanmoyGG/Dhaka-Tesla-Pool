"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { describeApiError } from "@/lib/api";
import { useAcceptPool } from "@/lib/queries";
import type { DriverPoolView } from "@/lib/types";

// One UNASSIGNED pool in the driver lobby (ADR-022). Nobody owns it yet, so
// there is no Tesla to show; the card lists who is riding and offers the
// first-wins Accept claim right here (the detail page 404s for unclaimed
// pools). A lost race surfaces as POOL_ALREADY_ACCEPTED and the lobby refetch
// drops the pool.
export function LobbyPoolCard({ pool }: { pool: DriverPoolView }) {
  const accept = useAcceptPool();
  const [error, setError] = useState<string | null>(null);

  function onAccept() {
    setError(null);
    accept.mutate(pool.id, {
      onError: (err) => setError(describeApiError(err)),
    });
  }

  const firstRider = pool.members[0];

  return (
    <article className="card">
      <div className="row space-between">
        <h3 className="card-title">Waiting for a driver</h3>
        <StatusBadge status={pool.status} />
      </div>

      <p className="card-seats text-muted">
        {pool.occupiedSeats} of {pool.capacitySnapshot} seats ·{" "}
        {pool.occupiedSeats} rider seat{pool.occupiedSeats === 1 ? "" : "s"}
        {firstRider
          ? ` · ${firstRider.pickupZoneName} → ${firstRider.destinationZoneName}`
          : ""}
      </p>

      <div className="row space-between mt">
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={accept.isPending}
          onClick={onAccept}
        >
          {accept.isPending ? "Claiming…" : "Accept ride"}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </article>
  );
}