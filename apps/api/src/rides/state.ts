// Explicit ride/pool state machine (Phase 5). The full PRD lifecycle
// (docs/requirements.md §4, database.md §5.2) is declared here as a single map,
// and every state change in the services goes through these transitions so
// invalid moves are rejected instead of silently stored.
//
// Phase 5 exercises REQUESTED → MATCHED (auto-match) and REQUESTED/MATCHED →
// CANCELLED (passenger cancel, force-cancel). DRIVER_ARRIVED → STARTED →
// COMPLETED arrive with the driver flow (Phase 6) and are declared now so the
// map is complete and explainable.

import type { rideStatusEnum } from "../db/schema.js";

export type RideStatus = typeof rideStatusEnum.enumValues[number];

// Terminal states: nothing may leave them.
const TERMINAL: readonly RideStatus[] = ["COMPLETED", "CANCELLED"];

export const RIDE_STATE_TRANSITIONS: Readonly<
  Record<RideStatus, readonly RideStatus[]>
> = {
  REQUESTED: ["MATCHED", "CANCELLED"],
  MATCHED: ["DRIVER_ARRIVED", "CANCELLED"],
  DRIVER_ARRIVED: ["STARTED", "CANCELLED"],
  STARTED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function isTerminal(status: RideStatus): boolean {
  return TERMINAL.includes(status);
}

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  if (from === to) return false;
  return RIDE_STATE_TRANSITIONS[from].includes(to);
}

// Returns a readable reason when a transition is invalid (used by the error
// message), or null when the transition is allowed.
export function invalidTransitionReason(
  from: RideStatus,
  to: RideStatus,
): string | null {
  if (isTerminal(from)) {
    return `ride is already ${from} and cannot move to ${to}`;
  }
  if (from === to) {
    return `transition to the same state ${from} is rejected`;
  }
  if (!canTransition(from, to)) {
    return `invalid transition ${from} -> ${to}`;
  }
  return null;
}