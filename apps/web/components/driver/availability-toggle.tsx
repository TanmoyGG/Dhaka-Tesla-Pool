"use client";

import { useState } from "react";
import { describeApiError } from "@/lib/api";
import { useDriverAvailability, useSetAvailability } from "@/lib/queries";

// Online/offline switch for the driver hub. The backend enforces going
// offline while ANY pool is non-terminal (409 DRIVER_HAS_ACTIVE_POOL,
// requirements.md §21.J); this surfaces that refusal next to the switch.
export function AvailabilityToggle() {
  const availability = useDriverAvailability();
  const toggle = useSetAvailability();
  const [error, setError] = useState<string | null>(null);

  if (availability.isLoading) {
    return (
      <div className="card">
        <p className="text-muted">Loading availability…</p>
      </div>
    );
  }

  if (availability.isError) {
    return (
      <div className="notice notice-error" role="alert">
        <p>{describeApiError(availability.error)}</p>
      </div>
    );
  }

  const isOnline = availability.data?.isOnline ?? false;

  function onToggle(next: boolean) {
    setError(null);
    toggle.mutate(next, {
      onError: (err) => setError(describeApiError(err)),
    });
  }

  return (
    <div className="card">
      <div className="switch-row">
        <span className="switch">
          <input
            type="checkbox"
            id="availability"
            aria-label="Available for rides"
            checked={isOnline}
            disabled={toggle.isPending}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
        </span>
        <span className={`switch-status ${isOnline ? "online" : "offline"}`}>
          {toggle.isPending
            ? "Updating…"
            : isOnline
              ? "Online — accepting new pools"
              : "Offline"}
        </span>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}