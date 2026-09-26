"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useCancelRide } from "@/lib/queries";
import { isCancellable, type RideStatus } from "@/lib/types";

// Cancel action, offered only while cancellation is legal for this status
// (REQUESTED / MATCHED / DRIVER_ARRIVED). STARTED, COMPLETED, and CANCELLED
// rides render nothing.
export function CancelRideButton({
  rideId,
  status,
}: {
  rideId: string;
  status: RideStatus;
}) {
  const cancel = useCancelRide();
  const [error, setError] = useState<string | null>(null);

  if (!isCancellable(status)) {
    return null;
  }

  function onSubmit() {
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
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {error && <p className="error-text">{error}</p>}
      <button
        type="submit"
        className="btn btn-danger"
        disabled={cancel.isPending}
      >
        {cancel.isPending ? "Cancelling…" : "Cancel ride"}
      </button>
    </form>
  );
}