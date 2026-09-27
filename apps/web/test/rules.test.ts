// Pure-logic tests: the client error mapping (which decides what users see
// for each backend error code), the state machines the API enforces, and the
// display formatters. These mirror the injection-safe invariants: no DOM,
// no network.

import { describe, expect, it } from "vitest";
import { ApiError, describeApiError } from "@/lib/api";
import {
  isCancellable,
  isTerminal,
  RideStatus,
} from "@/lib/types";
import { formatPaisa, formatStatus } from "@/lib/format";
import { nextPoolAction } from "@/lib/pool-actions";
import { makeDriverPool } from "./fixtures";

describe("describeApiError", () => {
  it("maps the book-while-active race to a calm message", () => {
    const error = new ApiError("ACTIVE_RIDE_EXISTS", "You already have an active ride.");
    expect(describeApiError(error)).toBe(
      "You already have an active ride. Complete or cancel it before booking another.",
    );
  });

  it("maps going offline mid-trip to an actionable message", () => {
    const error = new ApiError("DRIVER_HAS_ACTIVE_POOL", "refused");
    expect(describeApiError(error)).toContain("active trip");
  });

  it("maps a pool that moved on while racing to a refresh hint", () => {
    const error = new ApiError("INVALID_STATE_TRANSITION", "no");
    expect(describeApiError(error)).toContain("changed before the action finished");
  });

  it("maps role refusal to a permission message", () => {
    expect(describeApiError(new ApiError("FORBIDDEN", "no"))).toBe(
      "You do not have permission to do that.",
    );
  });

  it("maps VEHICLE_OFFLINE to a go-online instruction", () => {
    expect(describeApiError(new ApiError("VEHICLE_OFFLINE", "Bullet is offline"))).toBe(
      "No Tesla of yours can carry this ride right now. Go online in your dashboard and try again.",
    );
  });

  it("maps POOL_ALREADY_ACCEPTED (a lost accept race) to a refresh hint", () => {
    expect(describeApiError(new ApiError("POOL_ALREADY_ACCEPTED", "no"))).toContain(
      "Another driver just claimed",
    );
  });

  it("maps POOL_NOT_ACCEPTABLE to a refresh hint", () => {
    expect(describeApiError(new ApiError("POOL_NOT_ACCEPTABLE", "no"))).toContain(
      "no longer waiting to be accepted",
    );
  });

  it("falls back gracefully for non-ApiError failures", () => {
    expect(describeApiError("boom")).toBe("Something went wrong.");
    expect(describeApiError(new Error("network down"))).toBe("network down");
  });
});

describe("ride state rules (mirror of the backend state machine)", () => {
  it("cancellation is only legal before the trip starts", () => {
    for (const status of ["REQUESTED", "MATCHED", "DRIVER_ARRIVED"] as RideStatus[]) {
      expect(isCancellable(status)).toBe(true);
    }
    for (const status of ["STARTED", "COMPLETED", "CANCELLED"] as RideStatus[]) {
      expect(isCancellable(status)).toBe(false);
    }
  });

  it("isTerminal recognizes completed and cancelled", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("STARTED")).toBe(false);
    expect(isTerminal("REQUESTED")).toBe(false);
    expect(isTerminal("MATCHED")).toBe(false);
  });
});

describe("display formatters", () => {
  it("formats integer paisa as BDT with two decimals", () => {
    expect(formatPaisa(5932)).toBe("৳59.32");
    expect(formatPaisa(0)).toBe("৳0.00");
  });

  it("labels every state", () => {
    expect(formatStatus("DRIVER_ARRIVED")).toBe("Driver arrived");
    expect(formatStatus("CANCELLED")).toBe("Cancelled");
  });
});

describe("driver lifecycle mapping (next legal action)", () => {
  it("an UNASSIGNED MATCHED wait pool offers accept (first-wins claim)", () => {
    expect(nextPoolAction(makeDriverPool({ vehicle: null, acceptedAt: null }))).toEqual({
      action: "accept",
      label: "Accept ride",
    });
  });

  it("a pool the driver accepted already moves on to arrive", () => {
    expect(nextPoolAction(makeDriverPool())).toEqual({
      action: "arrive",
      label: "I have arrived",
    });
  });

  it("advances through start and complete", () => {
    expect(nextPoolAction(makeDriverPool({ status: "DRIVER_ARRIVED" }))).toEqual({
      action: "start",
      label: "All aboard — start trip",
    });
    expect(nextPoolAction(makeDriverPool({ status: "STARTED" }))).toEqual({
      action: "complete",
      label: "Complete trip",
    });
  });

  it("offers no action for terminal pools", () => {
    expect(nextPoolAction(makeDriverPool({ status: "COMPLETED" }))).toBeNull();
    expect(nextPoolAction(makeDriverPool({ status: "CANCELLED" }))).toBeNull();
  });
});