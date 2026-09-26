// RoleGate: frontend role split. The backend enforces roles on every request;
// this only redirects the wrong role away so a driver never sees the passenger
// booking form (and vice versa).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoleGate } from "@/components/role-gate";

const { useMe } = vi.hoisted(() => ({ useMe: vi.fn() }));
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("@/lib/queries", () => ({ useMe }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

function asUser(role: "PASSENGER" | "DRIVER") {
  useMe.mockReturnValue({
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: { role, id: "u1", name: "Test User", email: "test@example.com" },
  });
}

describe("RoleGate", () => {
  beforeEach(() => {
    replace.mockReset();
  });

  it("renders children for an allowed role", () => {
    asUser("PASSENGER");
    render(
      <RoleGate roles={["PASSENGER"]} fallback="/driver">
        <p>Passenger only content</p>
      </RoleGate>,
    );
    expect(screen.getByText("Passenger only content")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects a DRIVER away from a passenger-only page", () => {
    asUser("DRIVER");
    render(
      <RoleGate roles={["PASSENGER"]} fallback="/driver">
        <p>Passenger only content</p>
      </RoleGate>,
    );
    expect(replace).toHaveBeenCalledWith("/driver");
    expect(screen.queryByText("Passenger only content")).not.toBeInTheDocument();
  });

  it("redirects a PASSENGER away from the driver hub", () => {
    asUser("PASSENGER");
    render(
      <RoleGate roles={["DRIVER"]} fallback="/rides">
        <p>Driver only content</p>
      </RoleGate>,
    );
    expect(replace).toHaveBeenCalledWith("/rides");
  });
});