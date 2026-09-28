// One-time cash-payment acknowledgement for a completed ride (frontend-design
// §5.x completion modal). localStorage (not just component state) so an
// acknowledged ride NEVER re-shows the modal — not on the next poll tick, not
// after navigating between /rides and /rides/[rideId], and not after a reload.
// This is purely a passenger-side UI acknowledgement: there is no payment
// backend in the MVP, the driver is paid cash.

const PREFIX = "dhakaTeslaPool:paid-cash:";

function completedAckKey(rideId: string): string {
  return `${PREFIX}${rideId}`;
}

// Both helpers are try/catch-safe: private browsing / storage failure must
// never break the ride UI (worst case the modal is offered again).
export function hasAcknowledged(rideId: string): boolean {
  try {
    return window.localStorage.getItem(completedAckKey(rideId)) === "1";
  } catch {
    return false;
  }
}

export function acknowledge(rideId: string): void {
  try {
    window.localStorage.setItem(completedAckKey(rideId), "1");
  } catch {
    // Ignore — see hasAcknowledged.
  }
}