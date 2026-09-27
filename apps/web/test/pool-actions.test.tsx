// PoolActions: only the single legal next driver lifecycle action renders
// (accept → arrive → start → complete). The backend re-enforces legality;
// the UI must never offer an illegal button.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PoolActions } from "@/components/driver/pool-actions";
import { makeDriverPool, makeWaitPool } from "./fixtures";

const queries = vi.hoisted(() => ({
  useAcceptPool: vi.fn(),
  useArrivePool: vi.fn(),
  useStartPool: vi.fn(),
  useCompletePool: vi.fn(),
}));

vi.mock("@/lib/queries", () => queries);

function mockHook(hook: ReturnType<typeof queries.useAcceptPool>, mutate: ReturnType<typeof vi.fn>) {
  hook.mockReturnValue({ isPending: false, mutate });
}

describe("PoolActions", () => {
  const acceptMutate = vi.fn();
  const arriveMutate = vi.fn();
  const startMutate = vi.fn();
  const completeMutate = vi.fn();

  beforeEach(() => {
    acceptMutate.mockReset();
    arriveMutate.mockReset();
    startMutate.mockReset();
    completeMutate.mockReset();
    mockHook(queries.useAcceptPool, acceptMutate);
    mockHook(queries.useArrivePool, arriveMutate);
    mockHook(queries.useStartPool, startMutate);
    mockHook(queries.useCompletePool, completeMutate);
  });

  it("offers accept on a fresh unassigned MATCHED wait pool", () => {
    render(<PoolActions pool={makeWaitPool()} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept ride" }));
    expect(acceptMutate).toHaveBeenCalledWith("d1f9d4a0-0000-0000-0000-000000000007", expect.any(Object));
  });

  it("offers arrive once accepted, start when arrived, complete when started", () => {
    render(
      <PoolActions
        pool={makeDriverPool({ acceptedAt: "2026-09-27T10:05:00.000Z" })}
      />,
    );
    expect(screen.getByRole("button", { name: "I have arrived" })).toBeInTheDocument();

    render(<PoolActions pool={makeDriverPool({ status: "DRIVER_ARRIVED" })} />);
    expect(screen.getByRole("button", { name: /start trip/i })).toBeInTheDocument();

    render(<PoolActions pool={makeDriverPool({ status: "STARTED" })} />);
    expect(screen.getByRole("button", { name: "Complete trip" })).toBeInTheDocument();
  });

  it("renders no action buttons for terminal pools", () => {
    const { container } = render(
      <PoolActions pool={makeDriverPool({ status: "COMPLETED" })} />,
    );
    expect(container.querySelector("button")).toBeNull();
  });
});