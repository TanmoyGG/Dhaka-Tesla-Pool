// The split resizer must be wired into BOTH mobile workspaces, not just the
// shared primitive. `WorkspaceShell` is the only place that renders the grip, so
// these page-level tests prove the passenger `/rides` and driver `/driver`
// surfaces both get it — and both keep the map/panel/grip sibling structure that
// makes the panel grow by shrinking the map rather than covering it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import RidesPage from "@/app/(main)/rides/page";
import DriverDashboardPage from "@/app/(main)/driver/page";
import { makeZone } from "./fixtures";

const queries = vi.hoisted(() => ({
  useMe: vi.fn(),
  useRides: vi.fn(),
  useZones: vi.fn(),
  useCreateRide: vi.fn(),
  useEstimateRide: vi.fn(),
  useDriverAvailability: vi.fn(),
  useSetAvailability: vi.fn(),
  useAvailablePools: vi.fn(),
  useDriverPools: vi.fn(),
  useDriverHistory: vi.fn(),
  useAcceptPool: vi.fn(),
  useCancelRide: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
// Leaflet is only ever mounted through next/dynamic (ssr: false); a test never
// boots a real map, so both the wrapper and the pane are stubbed.
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (
    loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>,
  ) => {
    function DynamicMock(props: Record<string, unknown>) {
      const [Component, setComponent] = useState<React.ComponentType<
        Record<string, unknown>
      > | null>(null);
      useEffect(() => {
        let alive = true;
        loader().then((module) => {
          if (alive) setComponent(() => module.default);
        });
        return () => {
          alive = false;
        };
      }, []);
      if (!Component) return null;
      return <Component {...props} />;
    }
    return DynamicMock;
  },
}));
vi.mock("@/components/workspace/map-pane", () => ({
  default: () => <div data-testid="map-pane" />,
}));
vi.mock("@/lib/queries", () => queries);

beforeEach(() => {
  queries.useMe.mockReturnValue({
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: {
      role: "PASSENGER",
      id: "p-1",
      name: "Nusrat Haque",
      email: "nusrat@example.com",
    },
  });
  queries.useRides.mockReturnValue({ isLoading: false, isError: false, data: [] });
  // Passenger booking form data, so /rides renders its real controls.
  queries.useZones.mockReturnValue({
    isLoading: false,
    isError: false,
    data: [makeZone(), makeZone({ id: "y", name: "Mohakhali" })],
  });
  queries.useCreateRide.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  queries.useEstimateRide.mockReturnValue({
    isPending: false,
    isError: false,
    data: undefined,
  });
  queries.useDriverAvailability.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { isOnline: true },
  });
  queries.useSetAvailability.mockReturnValue({
    isPending: false,
    mutate: vi.fn(),
  });
  queries.useAcceptPool.mockReturnValue({ isPending: false, mutate: vi.fn() });
  queries.useAvailablePools.mockReturnValue({
    isLoading: false,
    isError: false,
    data: [],
  });
  queries.useDriverPools.mockReturnValue({
    isLoading: false,
    isError: false,
    data: [],
  });
  queries.useDriverHistory.mockReturnValue({
    isLoading: false,
    isError: false,
    data: [],
  });
});

function expectResizableWorkspace() {
  const shell = screen.getByRole("main");
  const grip = screen.getByRole("separator", { name: /resize map and panel/i });

  // Map, panel and grip are siblings in one grid — the panel can only shrink
  // the map, never overlay it.
  expect([...shell.children].map((child) => child.className)).toEqual([
    "workspace-panel",
    "workspace-map",
    "workspace-grip",
  ]);
  expect(grip).toHaveAttribute("aria-valuenow", "50");
  expect(shell.style.getPropertyValue("--workspace-map-rows")).toBe("1fr");
  return { shell, grip };
}

describe("passenger /rides workspace", () => {
  it("exposes the draggable split at the 50/50 default", () => {
    render(<RidesPage />);

    expect(screen.getByRole("heading", { name: /book a ride/i })).toBeInTheDocument();
    expectResizableWorkspace();
  });

  it("grows the panel from the keyboard without touching the booking form", () => {
    render(<RidesPage />);
    const { grip } = expectResizableWorkspace();

    fireEvent.keyDown(grip, { key: "ArrowUp" });

    expect(grip).toHaveAttribute("aria-valuenow", "30");
    expect(grip).toHaveAttribute("aria-valuetext", "Map 30%, panel 70%");
    // The ride controls are untouched by the resize.
    expect(screen.getByRole("heading", { name: /book a ride/i })).toBeInTheDocument();
  });
});

describe("driver /driver workspace", () => {
  it("exposes the draggable split at the 50/50 default", () => {
    queries.useMe.mockReturnValue({
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: {
        role: "DRIVER",
        id: "d-1",
        name: "Jashim Ahmed",
        email: "jashim@example.com",
      },
    });
    render(<DriverDashboardPage />);

    expect(
      screen.getByRole("heading", { name: /driver workspace/i }),
    ).toBeInTheDocument();
    expectResizableWorkspace();
  });

  it("grows the panel from the keyboard without touching driver actions", () => {
    queries.useMe.mockReturnValue({
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: {
        role: "DRIVER",
        id: "d-1",
        name: "Jashim Ahmed",
        email: "jashim@example.com",
      },
    });
    render(<DriverDashboardPage />);
    const { grip } = expectResizableWorkspace();

    fireEvent.keyDown(grip, { key: "ArrowUp" });

    expect(grip).toHaveAttribute("aria-valuenow", "30");
    expect(
      screen.getByRole("heading", { name: /availability/i }),
    ).toBeInTheDocument();
  });
});
