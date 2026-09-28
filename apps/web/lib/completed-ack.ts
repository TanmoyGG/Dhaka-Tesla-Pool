// One-time cash-payment acknowledgement for a completed trip (frontend-design
// §5.x / §6.5 completion modals). localStorage (not just component state) so an
// acknowledged trip NEVER re-shows the modal — not on the next poll tick, not
// after navigating between the workspace and the detail page, and not after a
// reload. This is purely a UI acknowledgement: there is no payment backend in
// the MVP, the driver is paid cash.
//
// The scope id is a ride id on the passenger side and a pool id on the driver
// side; both share the same storage prefix so an acknowledgement is scoped to
// exactly one completed trip.

const PREFIX = "dhakaTeslaPool:paid-cash:";

function completedAckKey(scopeId: string): string {
  return `${PREFIX}${scopeId}`;
}

// Both helpers are try/catch-safe: private browsing / storage failure must
// never break the ride UI (worst case the modal is offered again).
export function hasAcknowledged(scopeId: string): boolean {
  try {
    return window.localStorage.getItem(completedAckKey(scopeId)) === "1";
  } catch {
    return false;
  }
}

export function acknowledge(scopeId: string): void {
  try {
    window.localStorage.setItem(completedAckKey(scopeId), "1");
  } catch {
    // Ignore — see hasAcknowledged.
  }
}