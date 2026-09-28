// RideCompletionModal — the one-time cash-payment acknowledgement for a
// completed ride. Must show exactly the heading, the passenger's backend-
// provided total fare, and the "Paid cash" flow; must NEVER re-show a ride
// that was already acknowledged (localStorage), regardless of remounts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RideCompletionModal } from "@/components/ride-completion-modal";
import { makeRide } from "./fixtures";
import { acknowledge } from "@/lib/completed-ack";

const RIDE_ID = makeRide().id;

function completedRide() {
  return makeRide({ status: "COMPLETED" });
}

describe("RideCompletionModal", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing without a ride", () => {
    render(<RideCompletionModal ride={null} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing while the ride is not yet completed", () => {
    render(<RideCompletionModal ride={makeRide({ status: "STARTED" })} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the completion heading, route, backend total fare, and paid-cash action", () => {
    render(<RideCompletionModal ride={completedRide()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your ride is complete" })).toBeInTheDocument();
    expect(screen.getByText("Banani → Mohakhali")).toBeInTheDocument();
    expect(screen.getByText("৳59.32")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paid cash" })).toBeInTheDocument();
  });

  it("switches to the thanks message on Paid cash and auto-dismisses shortly after", () => {
    vi.useFakeTimers();
    render(<RideCompletionModal ride={completedRide()} />);

    fireEvent.click(screen.getByRole("button", { name: "Paid cash" }));

    expect(
      screen.getByText("Thanks for riding with Dhaka Tesla Pool"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paid cash" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(`dhakaTeslaPool:paid-cash:${RIDE_ID}`)).toBe("1");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("never re-shows an acknowledged ride after a remount", () => {
    const { unmount } = render(<RideCompletionModal ride={completedRide()} />);
    fireEvent.click(screen.getByRole("button", { name: "Paid cash" }));
    unmount();

    render(<RideCompletionModal ride={completedRide()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing from the start for a ride acknowledged earlier", () => {
    acknowledge(RIDE_ID);
    render(<RideCompletionModal ride={completedRide()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});