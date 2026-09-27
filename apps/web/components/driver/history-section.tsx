"use client";

import { DriverPoolCard } from "./pool-card";
import { useDriverHistory } from "@/lib/queries";
import { EmptyState, ErrorCard, LoadingState } from "../state-components";

// Driver trip history (docs/frontend-design.md §6.6): completed pools from
// GET /api/driver/pools/history (capped at 10 by the API — no load more), on
// a menu-driven route instead of the dashboard. Immutable data — no polling.
export function DriverHistorySection() {
  const history = useDriverHistory();

  return (
    <>
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
    </>
  );
}