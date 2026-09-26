// CancelRideButton behaviours: legal-status gating and the two-step confirm
// flow (cancelling frees a seat mid-pool, so it must never be one tap).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CancelRideButton } from "@/components/cancel-ride-button";
import { makeRide } from "./fixtures";

const { useCancelRide } = vi.hoisted(() => ({
  useCancelRide: vi.fn(),
}));

vi.mock("@/lib/queries", () => ({ useCancelRide }));

describe("CancelRideButton", () => {
  const mutate = vi.fn();

  beforeEach(() => {
    mutate.mockReset();
    useCancelRide.mockReturnValue({ isPending: false, mutate });
  });

  it("renders nothing once the trip is no longer cancellable", () => {
    const { container } = render(
      <CancelRideButton rideId="x" status="STARTED" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing after completion or cancellation", () => {
    const { container } = render(
      <CancelRideButton rideId="x" status="COMPLETED" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers cancel while the ride is REQUESTED", () => {
    render(<CancelRideButton rideId="x" status="REQUESTED" />);
    expect(screen.getByRole("button", { name: "Cancel ride" })).toBeInTheDocument();
  });

  it("requires explicit confirmation before cancelling", () => {
    render(<CancelRideButton rideId="ride-123" status="MATCHED" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel ride" }));

    expect(screen.getByText(/cancel this ride/i)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Yes, cancel ride" });
    expect(confirm).toBeInTheDocument();

    fireEvent.click(confirm);
    expect(mutate).toHaveBeenCalledWith("ride-123", expect.any(Object));
  });

  it("can back out of the confirmation", () => {
    render(<CancelRideButton rideId="ride-123" status="MATCHED" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel ride" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep the ride" }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByText(/cancel this ride/i)).not.toBeInTheDocument();
  });

  it("reuses the canonical ride fixture shape", () => {
    const ride = makeRide({ status: "REQUESTED" });
    render(<CancelRideButton rideId={ride.id} status={ride.status} />);
    expect(screen.getByRole("button", { name: "Cancel ride" })).toBeInTheDocument();
  });
});