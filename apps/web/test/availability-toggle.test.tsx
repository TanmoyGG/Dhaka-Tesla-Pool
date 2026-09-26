// AvailabilityToggle: the driver online/offline switch. It reads the true
// availability snapshot and sends the flip to the backend (which refuses
// going offline mid-trip with 409 DRIVER_HAS_ACTIVE_POOL).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AvailabilityToggle } from "@/components/driver/availability-toggle";

const queries = vi.hoisted(() => ({
  useDriverAvailability: vi.fn(),
  useSetAvailability: vi.fn(),
}));

vi.mock("@/lib/queries", () => queries);

describe("AvailabilityToggle", () => {
  const mutate = vi.fn();

  beforeEach(() => {
    mutate.mockReset();
    queries.useDriverAvailability.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { isOnline: true },
    });
    queries.useSetAvailability.mockReturnValue({ isPending: false, mutate });
  });

  it("renders the current availability state", () => {
    render(<AvailabilityToggle />);
    const toggle = screen.getByLabelText("Available for rides") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.getByText(/online — accepting new pools/i)).toBeInTheDocument();
  });

  it("flips the switch offline and calls the backend", () => {
    render(<AvailabilityToggle />);
    const toggle = screen.getByLabelText("Available for rides");
    fireEvent.click(toggle);
    expect(mutate).toHaveBeenCalledWith(false, expect.any(Object));
  });

  it("keeps an offline snapshot rendered as offline", () => {
    queries.useDriverAvailability.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { isOnline: false },
    });
    render(<AvailabilityToggle />);
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });
});