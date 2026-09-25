// Unit tests for the explicit ride state machine (Phase 5, docs/requirements.md
// §4, database.md §5.2). No database: the transition map is pure data that must
// reject every documented-invalid move before any service ever writes a row.

import { describe, expect, it } from "vitest";
import {
  canTransition,
  invalidTransitionReason,
  isTerminal,
  RIDE_STATE_TRANSITIONS,
} from "../src/rides/state.js";

describe("ride state machine", () => {
  it("declares the full PRD lifecycle", () => {
    // REQUESTED -> MATCHED -> DRIVER_ARRIVED -> STARTED -> COMPLETED, with
    // CANCELLED reachable from every active state.
    expect(canTransition("REQUESTED", "MATCHED")).toBe(true);
    expect(canTransition("MATCHED", "DRIVER_ARRIVED")).toBe(true);
    expect(canTransition("DRIVER_ARRIVED", "STARTED")).toBe(true);
    expect(canTransition("STARTED", "COMPLETED")).toBe(true);
    for (const from of ["REQUESTED", "MATCHED", "DRIVER_ARRIVED"] as const) {
      expect(canTransition(from, "CANCELLED")).toBe(true);
    }
  });

  it("rejects invalid transitions", () => {
    // Skip a stage.
    expect(canTransition("REQUESTED", "DRIVER_ARRIVED")).toBe(false);
    expect(canTransition("REQUESTED", "STARTED")).toBe(false);
    // Backwards / sideways moves.
    expect(canTransition("MATCHED", "REQUESTED")).toBe(false);
    expect(canTransition("STARTED", "DRIVER_ARRIVED")).toBe(false);
    expect(canTransition("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransition("CANCELLED", "MATCHED")).toBe(false);
  });

  it("treats COMPLETED and CANCELLED as terminal", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("STARTED")).toBe(false);
    expect(isTerminal("REQUESTED")).toBe(false);
  });

  it("rejects same-state transitions", () => {
    for (const state of ["REQUESTED", "MATCHED", "CANCELLED"] as const) {
      expect(canTransition(state, state)).toBe(false);
      expect(invalidTransitionReason(state, state)).not.toBeNull();
    }
  });

  it("produces a readable reason for an invalid transition", () => {
    expect(invalidTransitionReason("COMPLETED", "CANCELLED")).toMatch(
      /COMPLETED.*CANCELLED/,
    );
    expect(invalidTransitionReason("REQUESTED", "STARTED")).toMatch(
      /REQUESTED.*STARTED/,
    );
    // The happy path is null (no reason to reject).
    expect(invalidTransitionReason("REQUESTED", "MATCHED")).toBeNull();
  });

  it("is a complete map covering every enum state", () => {
    const all = RIDE_STATE_TRANSITIONS;
    const statuses: Array<keyof typeof all> = [
      "REQUESTED",
      "MATCHED",
      "DRIVER_ARRIVED",
      "STARTED",
      "COMPLETED",
      "CANCELLED",
    ];
    for (const status of statuses) {
      expect(Array.isArray(all[status])).toBe(true);
    }
  });
});