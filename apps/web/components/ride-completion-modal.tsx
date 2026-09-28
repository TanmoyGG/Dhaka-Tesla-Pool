"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { acknowledge, hasAcknowledged } from "@/lib/completed-ack";
import { formatPaisa } from "@/lib/format";
import type { RideView } from "@/lib/types";

// Passenger-side one-time acknowledgement that a completed ride was paid in
// cash (rights §5.x). MVP only: there is NO payment backend — the driver is
// paid cash, this confirms it. The acknowledgement is persisted (localStorage)
// so an acknowledged ride never re-shows the modal on the next poll tick, after
// navigating between /rides and /rides/[rideId], or after a reload.
//
// Portaled to <body> for the same reason as the app drawer: the sticky header's
// `backdrop-filter` turns it into a containing block for `position: fixed`, so
// an in-tree modal would render inside the header's box instead of over the
// viewport. The "Paid cash" button is the ONLY dismissal — an overlay/Escape
// close would let a passenger skip the acknowledgement silently.

const THANKS_DISMISS_MS = 1500;

export function RideCompletionModal({ ride }: { ride: RideView | null }) {
  const [open, setOpen] = useState(false);
  const [thanked, setThanked] = useState(false);
  const openedForRef = useRef<string | null>(null);

  const rideIsComplete = ride?.status === "COMPLETED";

  // Open exactly once per completed, unacknowledged ride id. Polling may hand
  // us a fresh object each tick; the ref makes the open decision idempotent.
  useEffect(() => {
    if (rideIsComplete && ride && !hasAcknowledged(ride.id) && openedForRef.current !== ride.id) {
      openedForRef.current = ride.id;
      setOpen(true);
      setThanked(false);
    }
  }, [ride, rideIsComplete]);

  // Auto-dismiss the thanks phase shortly after acknowledgment.
  useEffect(() => {
    if (!thanked) return;
    const timer = window.setTimeout(() => setOpen(false), THANKS_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [thanked]);

  // Lock page scroll while the modal is open (app-drawer pattern).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function handlePaidCash() {
    acknowledge(ride!.id);
    setThanked(true);
  }

  if (!open || !ride || !rideIsComplete) return null;

  return createPortal(
    <div
      className="completion-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="completion-heading"
    >
      <div className="completion-modal-overlay" />
      <div className="completion-modal-card">
        {thanked ? (
          <p id="completion-heading" className="completion-thanks">
            Thanks for riding with Dhaka Tesla Pool
          </p>
        ) : (
          <>
            <h2 id="completion-heading">Your ride is complete</h2>
            <p className="completion-route text-muted">
              {ride.pickupZone.name} → {ride.destinationZone.name}
            </p>
            <p className="completion-fare">
              Total fare <strong>{formatPaisa(ride.fare.estimatedTotalPaisa)}</strong>
            </p>
            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={handlePaidCash}
            >
              Paid cash
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}