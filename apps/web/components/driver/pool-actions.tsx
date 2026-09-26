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
export function PoolActions({ pool }: { pool: DriverPoolView }) {
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

  function onAction() {
    setError(null);
    hook.mutate(pool.id, {
      onError: (err) => setError(describeApiError(err)),
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