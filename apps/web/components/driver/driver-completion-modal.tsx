"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { acknowledge, hasAcknowledged } from "@/lib/completed-ack";
import { formatPaisa } from "@/lib/format";
import type { DriverPoolView } from "@/lib/types";

// Driver-side one-time cash acknowledgement for a completed pool
// (frontend-design.md §6.5). MVP only: there is NO payment backend — the
// driver is paid cash, this confirms the collected amount. The acknowledgement
// is persisted (localStorage) so a collected pool never re-shows the modal on
// the next poll tick, after switching between /driver and /driver/[poolId], or
// after a reload. Amounts come verbatim from the backend pool view
// (`member.fare.totalPaisa`, `earnings.totalCollectedPaisa`) — never
// recomputed here.
//
// Portaled to <body> for the same reason as the passenger modal: the sticky
// header's `backdrop-filter` turns it into a containing block for
// `position: fixed`. The "Cash received" button is the ONLY dismissal — an
// overlay/Escape close would let a driver skip the acknowledgement silently.

const THANKS_DISMISS_MS = 1500;

export function DriverCompletionModal({
  pool,
}: {
  pool: DriverPoolView | null;
}) {
  const [open, setOpen] = useState(false);
  const [thanked, setThanked] = useState(false);
  const openedForRef = useRef<string | null>(null);

  const poolIsComplete = pool?.status === "COMPLETED";

  // Open exactly once per completed, unacknowledged pool id. Polling may hand
  // us a fresh object each tick; the ref makes the open decision idempotent.
  useEffect(() => {
    if (
      poolIsComplete &&
      pool &&
      !hasAcknowledged(pool.id) &&
      openedForRef.current !== pool.id
    ) {
      openedForRef.current = pool.id;
      setOpen(true);
      setThanked(false);
    }
  }, [pool, poolIsComplete]);

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

  function handleCashReceived() {
    acknowledge(pool!.id);
    setThanked(true);
  }

  if (!open || !pool || !poolIsComplete) return null;

  const pickup = pool.members[0]?.pickupZoneName ?? "—";
  const destinations = [
    ...new Set(pool.members.map((member) => member.destinationZoneName)),
  ].join(" → ");

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
            <h2 id="completion-heading">Trip complete</h2>
            <p className="completion-route text-muted">
              {pickup} → {destinations}
            </p>
            <ul className="completion-passengers">
              {pool.members.map((member) => (
                <li key={member.rideRequestId}>
                  <span>
                    {member.passengerName} · {member.seats} seat
                    {member.seats === 1 ? "" : "s"}
                  </span>
                  <strong>{formatPaisa(member.fare.totalPaisa)}</strong>
                </li>
              ))}
            </ul>
            <p className="completion-fare">
              Total collected{" "}
              <strong>{formatPaisa(pool.earnings.totalCollectedPaisa)}</strong>
            </p>
            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={handleCashReceived}
            >
              Cash received
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}