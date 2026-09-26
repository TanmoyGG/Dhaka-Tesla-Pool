// BookingArea is the single gate that enforces the one-active-ride rule in
// the passenger UI (the backend enforces it independently with a partial
// unique index + 409 ACTIVE_RIDE_EXISTS). With an active ride the booking
// form must disappear and the passenger must be pointed at their live ride.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BookingArea } from "@/components/booking-area";
import { makeRide, makeZone } from "./fixtures";

const queries = vi.hoisted(() => ({
  useZones: vi.fn(),
  useCreateRide: vi.fn(),
  useEstimateRide: vi.fn(),
}));

vi.mock("@/lib/queries", () => queries);

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("BookingArea", () => {
  beforeEach(() => {
    queries.useZones.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [makeZone(), makeZone({ id: "y", name: "Mohakhali" })],
    });
    queries.useCreateRide.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    queries.useEstimateRide.mockReturnValue({
      isPending: false,
      isError: false,
      data: undefined,
    });
  });

  it("hides the booking form while a ride is active", () => {
    render(<BookingArea activeRide={makeRide({ status: "MATCHED" })} onBooked={vi.fn()} />);

    expect(screen.getByText("You have an active ride")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pickup zone")).not.toBeInTheDocument();
  });

  it("points the active passenger at their live ride detail", () => {
    const ride = makeRide({ status: "DRIVER_ARRIVED" });
    render(<BookingArea activeRide={ride} onBooked={vi.fn()} />);

    const link = screen.getByRole("link", { name: "View active ride" });
    expect(link).toHaveAttribute("href", `/rides/${ride.id}`);
    expect(screen.getByText("Driver arrived")).toBeInTheDocument();
  });

  it("shows the booking form once no ride is active", () => {
    render(<BookingArea activeRide={null} onBooked={vi.fn()} />);

    expect(screen.queryByText("You have an active ride")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pickup zone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book ride" })).toBeInTheDocument();
  });
});