// RideForm (Phase 4 booking UX): segmented seat stepper, live estimate gating,
// swap/auto-clear route behaviour, zone-selection reporting to the workspace
// map, and the booking-button states. Backend contracts are untouched — the
// form submits exactly pickupZoneId/destinationZoneId/requestedSeats and the
// estimate renders FareView verbatim (never computed).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RideForm } from "@/components/ride-form";
import { makeFare, makeRide, makeZone } from "./fixtures";

const queries = vi.hoisted(() => ({
  useZones: vi.fn(),
  useCreateRide: vi.fn(),
  useEstimateRide: vi.fn(),
}));

vi.mock("@/lib/queries", () => queries);

const PICKUP_ID = makeZone().id;
const DEST_ID = "y";
const ZONES = [makeZone(), makeZone({ id: DEST_ID, name: "Mohakhali" })];

describe("RideForm", () => {
  const onBooked = vi.fn();
  const onSelectionChange = vi.fn();

  beforeEach(() => {
    onBooked.mockReset();
    onSelectionChange.mockReset();
    queries.useZones.mockReturnValue({
      isLoading: false,
      isError: false,
      data: ZONES,
    });
    queries.useCreateRide.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue(makeRide()),
    });
    queries.useEstimateRide.mockReturnValue({
      isPending: false,
      isError: false,
      data: undefined,
    });
  });

  function selectZone(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  it("defaults the seat stepper to 1", () => {
    render(<RideForm onBooked={onBooked} />);
    const [one, two, three] = screen.getAllByRole("button", {
      name: /^[123]$/,
    });
    expect(one).toHaveAttribute("aria-pressed", "true");
    expect(two).toHaveAttribute("aria-pressed", "false");
    expect(three).toHaveAttribute("aria-pressed", "false");
  });

  it("moves aria-pressed when the passenger chooses seats", () => {
    render(<RideForm onBooked={onBooked} />);
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("keeps the fare estimate hidden while the form is incomplete", () => {
    render(<RideForm onBooked={onBooked} />);
    expect(screen.queryByText("Estimated fare")).not.toBeInTheDocument();
  });

  it("renders the backend estimate verbatim once the route and seats are valid", () => {
    queries.useEstimateRide.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeFare(),
    });
    render(<RideForm onBooked={onBooked} />);
    selectZone("Pickup zone", PICKUP_ID);
    selectZone("Destination zone", DEST_ID);

    expect(screen.getByText("Estimated fare")).toBeInTheDocument();
    expect(screen.getByText("Base fare")).toBeInTheDocument();
    expect(screen.getByText("৳59.32", { selector: ".estimate-total" })).toBeInTheDocument();
  });

  it("reports the chosen zones to the workspace for map feedback", () => {
    render(<RideForm onBooked={onBooked} onSelectionChange={onSelectionChange} />);
    selectZone("Pickup zone", PICKUP_ID);
    selectZone("Destination zone", DEST_ID);

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      pickupZoneId: PICKUP_ID,
      destinationZoneId: DEST_ID,
    });
  });

  it("swaps pickup and destination once both ends are chosen", () => {
    render(<RideForm onBooked={onBooked} />);
    selectZone("Pickup zone", PICKUP_ID);
    selectZone("Destination zone", DEST_ID);

    fireEvent.click(screen.getByRole("button", { name: "⇄ Swap pickup and destination" }));

    expect((screen.getByLabelText("Pickup zone") as HTMLSelectElement).value).toBe(DEST_ID);
    expect((screen.getByLabelText("Destination zone") as HTMLSelectElement).value).toBe(PICKUP_ID);
  });

  it("auto-clears the destination when the pickup is changed to match it", () => {
    render(<RideForm onBooked={onBooked} />);
    selectZone("Destination zone", DEST_ID);
    selectZone("Pickup zone", DEST_ID);

    expect((screen.getByLabelText("Destination zone") as HTMLSelectElement).value).toBe("");
  });

  it("validates on submit and calls the API only once the form is valid", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(makeRide());
    queries.useCreateRide.mockReturnValue({ isPending: false, mutateAsync });
    render(<RideForm onBooked={onBooked} />);

    fireEvent.click(screen.getByRole("button", { name: "Book ride" }));
    expect(await screen.findByText("Pickup zone is required")).toBeInTheDocument();
    expect(await screen.findByText("Destination zone is required")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps reporting the booked route after a successful booking", async () => {
    // Faithful to react-query's mutateAsync contract: on success it invokes the
    // caller's onSuccess (which calls onBooked). Our mock must do the same so
    // the post-booking form state is actually exercised.
    const mutateAsync = vi
      .fn()
      .mockImplementation((
        _input: unknown,
        options?: { onSuccess?: (ride: ReturnType<typeof makeRide>) => void },
      ) => {
        const ride = makeRide();
        options?.onSuccess?.(ride);
        return Promise.resolve(ride);
      });
    queries.useCreateRide.mockReturnValue({ isPending: false, mutateAsync });
    render(<RideForm onBooked={onBooked} onSelectionChange={onSelectionChange} />);
    selectZone("Pickup zone", PICKUP_ID);
    selectZone("Destination zone", DEST_ID);

    fireEvent.click(screen.getByRole("button", { name: "Book ride" }));
    await waitFor(() => expect(onBooked).toHaveBeenCalled());

    // Regression: the form must not reset after booking and lift an empty
    // selection up — the active ride's pins rely on this to stay highlighted.
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      pickupZoneId: PICKUP_ID,
      destinationZoneId: DEST_ID,
    });
    expect((screen.getByLabelText("Pickup zone") as HTMLSelectElement).value).toBe(PICKUP_ID);
  });

  it("disables the button and says Booking while a ride is being created", () => {
    queries.useCreateRide.mockReturnValue({
      isPending: true,
      mutateAsync: vi.fn(),
    });
    render(<RideForm onBooked={onBooked} />);
    const button = screen.getByRole("button", { name: "Booking…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});