// Maps a driver pool's status to the single legal next lifecycle action.
// Mirrors the backend state machine (accept → arrive → start → complete); the
// UI only offers legal transitions and lets the backend reject anything that
// raced meanwhile (409 INVALID_STATE_TRANSITION).
import type { DriverPoolView } from "./types";

export type PoolAction = "accept" | "arrive" | "start" | "complete";

export interface NextPoolAction {
  action: PoolAction;
  label: string;
}

export function nextPoolAction(pool: DriverPoolView): NextPoolAction | null {
  switch (pool.status) {
    case "MATCHED":
      // Accept is the FIRST-WINS claim of an UNASSIGNED wait pool (ADR-022);
      // once accepted the pool stays MATCHED and the next move is to arrive.
      // The discriminator is accepted_at: a pool the driver owns always has it
      // set (backend CHECK constraint), an unclaimed lobby pool never does.
      return pool.acceptedAt
        ? { action: "arrive", label: "I have arrived" }
        : { action: "accept", label: "Accept ride" };
    case "DRIVER_ARRIVED":
      return { action: "start", label: "All aboard — start trip" };
    case "STARTED":
      return { action: "complete", label: "Complete trip" };
    default:
      return null;
  }
}