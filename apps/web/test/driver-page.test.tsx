// Driver dashboard lobby gating (UX-only; the backend accept stays the
// security boundary): while the driver is OFFLINE the waiting-requests lobby
// (and its Accept actions) is replaced by a "go online to accept" notice;
// once ONLINE the normal lobby with Accept buttons returns.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DriverDashboardPage from "@/app/driver/page";
import { makeWaitPool } from "./fixtures";

const queries = vi.hoisted(() => ({
  useMe: vi.fn(),
  useDriverAvailability: vi.fn(),
  useSetAvailability: vi.fn(),
  useAvailablePools: vi.fn(),
  useDriverPools: vi.fn(),
  useDriverHistory: vi.fn(),
  useAcceptPool: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/queries", () => queries);

function driverAvailability(isOnline: boolean) {
  queries.useDriverAvailability.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { isOnline },
  });
}

const mutate = vi.fn();

beforeEach(() => {
  queries.useMe.mockReturnValue({
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: { role: "DRIVER", id: "driver-1", name: "Jashim Ahmed", email: "jashim@example.com" },
  });
  queries.useSetAvailability.mockReturnValue({ isPending: false, mutate });
  queries.useAcceptPool.mockReturnValue({ isPending: false, mutate });
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

describe("DriverDashboardPage lobby gating", () => {
  it("hides the waiting-request lobby and accepts while offline", () => {
    driverAvailability(false);
    queries.useAvailablePools.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [makeWaitPool()],
    });

    render(<DriverDashboardPage />);

    expect(screen.getByText(/go online.*accept/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept ride" })).toBeNull();
    expect(screen.queryByText(/waiting for a driver/i)).toBeNull();
  });

  it("shows the lobby with Accept actions once online", () => {
    driverAvailability(true);
    queries.useAvailablePools.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [makeWaitPool()],
    });

    render(<DriverDashboardPage />);

    expect(screen.queryByText(/go online.*accept/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Accept ride" })).toBeInTheDocument();
  });
});