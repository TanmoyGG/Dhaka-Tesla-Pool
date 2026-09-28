// Driver workspace (frontend-design.md §6): the map+panel shell lands the
// availability switch, the ONE active trip (whose card carries the lifecycle
// action right there) or — idle — the waiting-request lobby gated by the
// online switch plus the open-pools empty state. The map pane receives the
// active pool's pickup and ALL distinct member destination pins.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen } from "@testing-library/react";
import DriverDashboardPage from "@/app/(main)/driver/page";
import { makeDriverMember, makeDriverPool } from "./fixtures";
import type { DriverPoolView } from "@/lib/types";

const queries = vi.hoisted(() => ({
  useMe: vi.fn(),
  useDriverAvailability: vi.fn(),
  useSetAvailability: vi.fn(),
  useAvailablePools: vi.fn(),
  useDriverPools: vi.fn(),
  useAcceptPool: vi.fn(),
  useArrivePool: vi.fn(),
  useStartPool: vi.fn(),
  useCompletePool: vi.fn(),
}));

const mapPaneProps = vi.hoisted(() => ({
  last: null as { pickupZoneId?: string; destinationZoneIds?: string[] } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
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
  default: (props: { pickupZoneId?: string; destinationZoneIds?: string[] }) => {
    mapPaneProps.last = props;
    return <div data-testid="map-pane" />;
  },
}));
vi.mock("@/lib/queries", () => queries);

function availability(isOnline: boolean) {
  queries.useDriverAvailability.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { isOnline },
  });
}

function pools(pools: DriverPoolView[]) {
  queries.useDriverPools.mockReturnValue({
    isLoading: false,
    isError: false,
    data: pools,
  });
}

beforeEach(() => {
  queries.useMe.mockReturnValue({
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: { role: "DRIVER", id: "driver-1", name: "Jashim Ahmed", email: "jashim@example.com" },
  });
  queries.useSetAvailability.mockReturnValue({ isPending: false, mutate: vi.fn() });
  queries.useAvailablePools.mockReturnValue({
    isLoading: false,
    isError: false,
    data: [],
  });
  queries.useAcceptPool.mockReturnValue({ isPending: false, mutate: vi.fn() });
  queries.useArrivePool.mockReturnValue({ isPending: false, mutate: vi.fn() });
  queries.useStartPool.mockReturnValue({ isPending: false, mutate: vi.fn() });
  queries.useCompletePool.mockReturnValue({ isPending: false, mutate: vi.fn() });
  mapPaneProps.last = null;
});

describe("DriverDashboardPage workspace", () => {
  it("idle and online: shows the workspace with lobby and open-pools empty state", async () => {
    availability(true);
    pools([]);

    render(<DriverDashboardPage />);

    expect(
      screen.getByRole("heading", { name: "Driver workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Waiting requests" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no waiting requests right now/i)).toBeInTheDocument();
    expect(screen.getByText(/no open pools yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Active trip")).toBeNull();
    // Idle: the map gets no route selection (the pane is always mounted).
    expect(await screen.findByTestId("map-pane")).toBeInTheDocument();
    expect(mapPaneProps.last).toEqual({
      pickupZoneId: undefined,
      destinationZoneIds: undefined,
    });
  });

  it("renders the active-trip card (with lifecycle action + total) and hides the lobby", () => {
    availability(true);
    pools([
      makeDriverPool({
        id: "d1f9d4a0-0000-0000-0000-000000000002",
        status: "STARTED",
        startedAt: "2026-09-27T10:20:00.000Z",
      }),
    ]);

    render(<DriverDashboardPage />);

    expect(screen.getByRole("heading", { name: "Active trip" })).toBeInTheDocument();
    expect(screen.getByText("Bullet")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByText("৳59.32")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete trip" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View pool details" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Waiting requests" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept ride" })).toBeNull();
  });

  it("feeds the map the pool's pickup and ALL distinct member destinations", async () => {
    availability(true);
    pools([
      makeDriverPool({
        status: "MATCHED",
        members: [
          makeDriverMember(),
          makeDriverMember({
            rideRequestId: "e1a2b3c4-0000-0000-0000-000000000002",
            passengerId: "7c0f40a0-0000-0000-0000-000000000005",
            passengerName: "Rafiq Chowdhury",
            destinationZoneId: "b1a60c28-92e6-4f87-b2a4-6f5e8f3d11cc",
            destinationZoneName: "Gulshan 1",
          }),
        ],
      }),
    ]);

    render(<DriverDashboardPage />);

    expect(await screen.findByTestId("map-pane")).toBeInTheDocument();
    expect(mapPaneProps.last).toEqual({
      pickupZoneId: "b1a60c28-92e6-4f87-b2a4-6f5e8f3d11aa",
      destinationZoneIds: [
        "b1a60c28-92e6-4f87-b2a4-6f5e8f3d11bb",
        "b1a60c28-92e6-4f87-b2a4-6f5e8f3d11cc",
      ],
    });
  });

  it("hides the lobby while offline without an active trip", () => {
    availability(false);
    pools([]);

    render(<DriverDashboardPage />);

    expect(screen.getByText(/go online.*accept/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Waiting requests" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept ride" })).toBeNull();
  });
});