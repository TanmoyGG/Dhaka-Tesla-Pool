"use client";

import { useState } from "react";
import { useAcceptPool, useArrivePool, useStartPool, useCompletePool } from "@/lib/queries";
import { nextPoolAction, type PoolAction } from "@/lib/pool-actions";
import { describeApiError } from "@/lib/api";
import type { DriverPoolView } from "@/lib/types";

// Driver lifecycle buttons for a pool. Only the single legal next transition
// is rendered (accept → arrive → start → complete); a terminal or empty pool
// shows nothing. All four mutations are created unconditionally (hooks rules);
// no request fires until one is actually used.
export function PoolActions({
  pool,
  onCompleted,
}: {
  pool: DriverPoolView;
  // Notified with the completed pool view when THIS button finishes a trip —
  // the workspace feeds its cash-received modal straight from this result.
  onCompleted?: (pool: DriverPoolView) => void;
}) {
  const accept = useAcceptPool();
  const arrive = useArrivePool();
  const start = useStartPool();
  const complete = useCompletePool();
  const hooks: Record<PoolAction, typeof accept> = {
    accept,
    arrive,
    start,
    complete,
  };

  const next = nextPoolAction(pool);
  const [error, setError] = useState<string | null>(null);

  if (!next) {
    return null;
  }

  const hook = hooks[next.action];
  // Captured before the closure: completion is the only transition that hands
  // the finished pool to the workspace's completion flow.
  const completesTrip = next.action === "complete";

  function onAction() {
    setError(null);
    hook.mutate(pool.id, {
      onError: (err) => setError(describeApiError(err)),
      onSuccess: (updatedPool) => {
        if (completesTrip) onCompleted?.(updatedPool);
      },
    });
  }

  return (
    <div className="mt">
      {error && <p className="error-text">{error}</p>}
      <p className="text-muted text-small">
        Next action: {next.label.toLowerCase()}
      </p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={hook.isPending}
        onClick={onAction}
      >
        {hook.isPending ? "Working…" : next.label}
      </button>
    </div>
  );
}