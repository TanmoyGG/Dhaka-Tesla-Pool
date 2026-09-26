"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useCancelRide } from "@/lib/queries";
import { isCancellable, type RideStatus } from "@/lib/types";

// Cancel action, offered only while cancellation is legal for this status
// (REQUESTED / MATCHED / DRIVER_ARRIVED). STARTED, COMPLETED, and CANCELLED
// rides render nothing. A second press of the button asks for explicit
// confirmation — cancelling frees a seat and changes the pool for the other
// passengers, so it must never be a one-tap accident.
export function CancelRideButton({
  rideId,
  status,
}: {
  rideId: string;
  status: RideStatus;
}) {
  const cancel = useCancelRide();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isCancellable(status)) {
    return null;
  }

  function onConfirm() {
    setError(null);
    cancel.mutate(rideId, {
      onError: (err) => {
        // INVALID_STATE_TRANSITION is a normal race here: the pool has moved
        // on (e.g. the driver just started the ride) between when this page
        // loaded and when the cancel landed. Surface it rather than hiding it.
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not cancel this ride. Refresh and try again.",
        );
      },
      onSuccess: () => setConfirming(false),
    });
  }

  if (confirming) {
    return (
      <div className="confirm-pane" role="group" aria-label="Confirm cancellation">
        <p className="text-small">
          Cancel this ride? Your seat frees up for the other passengers and
          cannot be undone.
        </p>
        <div className="confirm-actions">
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={cancel.isPending}
            onClick={onConfirm}
          >
            {cancel.isPending ? "Cancelling…" : "Yes, cancel ride"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={cancel.isPending}
            onClick={() => setConfirming(false)}
          >
            Keep the ride
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt">
      {error && <p className="error-text">{error}</p>}
      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Cancel ride
      </button>
    </div>
  );
}