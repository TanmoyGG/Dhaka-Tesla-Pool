// DriverCompletionModal — the one-time cash acknowledgement for a completed
// pool. Shows the per-passenger backend fares and the total collected, and
// the "Cash received" flow; must NEVER re-show a pool that was already
// acknowledged (localStorage), regardless of remounts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DriverCompletionModal } from "@/components/driver/driver-completion-modal";
import { makeDriverMember, makeDriverPool } from "./fixtures";
import { acknowledge } from "@/lib/completed-ack";

const POOL_ID = "d1f9d4a0-0000-0000-0000-000000000009";

function completedPool() {
  return makeDriverPool({
    id: POOL_ID,
    status: "COMPLETED",
    completedAt: "2026-09-27T11:00:00.000Z",
    members: [
      makeDriverMember({
        passengerName: "Nusrat Haque",
        seats: 1,
        fare: { currency: "BDT", perSeatFarePaisa: 5932, totalPaisa: 5932 },
      }),
      makeDriverMember({
        rideRequestId: "e1a2b3c4-0000-0000-0000-000000000002",
        passengerId: "7c0f40a0-0000-0000-0000-000000000005",
        passengerName: "Rafiq Chowdhury",
        destinationZoneId: "b1a60c28-92e6-4f87-b2a4-6f5e8f3d11cc",
        destinationZoneName: "Gulshan 1",
        seats: 1,
        fare: { currency: "BDT", perSeatFarePaisa: 5932, totalPaisa: 5932 },
      }),
    ],
  });
}

describe("DriverCompletionModal", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing without a pool", () => {
    render(<DriverCompletionModal pool={null} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing while the pool is not yet completed", () => {
    render(<DriverCompletionModal pool={makeDriverPool({ status: "STARTED" })} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the heading, per-passenger fares, total collected, and cash action", () => {
    render(<DriverCompletionModal pool={completedPool()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trip complete" })).toBeInTheDocument();
    expect(screen.getByText("Banani → Mohakhali → Gulshan 1")).toBeInTheDocument();
    // Both passengers pay ৳59.32 (one seat each) — two rows with the same fare.
    expect(screen.getAllByText("৳59.32")).toHaveLength(2);
    expect(screen.getByText("Nusrat Haque · 1 seat")).toBeInTheDocument();
    expect(screen.getByText("Rafiq Chowdhury · 1 seat")).toBeInTheDocument();
    expect(screen.getByText("৳118.64")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cash received" })).toBeInTheDocument();
  });

  it("switches to the thanks message on Cash received and auto-dismisses shortly after", () => {
    vi.useFakeTimers();
    render(<DriverCompletionModal pool={completedPool()} />);

    fireEvent.click(screen.getByRole("button", { name: "Cash received" }));

    expect(
      screen.getByText("Thanks for riding with Dhaka Tesla Pool"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cash received" }),
    ).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem(`dhakaTeslaPool:paid-cash:${POOL_ID}`),
    ).toBe("1");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("never re-shows an acknowledged pool after a remount", () => {
    const { unmount } = render(<DriverCompletionModal pool={completedPool()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cash received" }));
    unmount();

    render(<DriverCompletionModal pool={completedPool()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing from the start for a pool acknowledged earlier", () => {
    acknowledge(POOL_ID);
    render(<DriverCompletionModal pool={completedPool()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});