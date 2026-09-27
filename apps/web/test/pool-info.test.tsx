// PoolInfo: the passenger-facing "is this a shared ride" surface. A pool with
// more than one seat occupied advertises the 25% pool discount; an unmatched
// request explains it is still waiting.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PoolInfo } from "@/components/pool-info";
import { makeRidePool, makeWaitRidePool } from "./fixtures";

describe("PoolInfo", () => {
  it("explains the request is still unmatched", () => {
    render(<PoolInfo pool={null} />);
    expect(screen.getByText(/not been matched yet/i)).toBeInTheDocument();
  });

  it("shows driver, Tesla, and seats for a solo match", () => {
    render(<PoolInfo pool={makeRidePool()} />);

    expect(screen.getByText("Jashim Ahmed")).toBeInTheDocument();
    expect(screen.getByText("Bullet")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 filled (33%)")).toBeInTheDocument();
  });

  it("shows a waiting-for-a-driver state for an unassigned wait pool", () => {
    render(<PoolInfo pool={makeWaitRidePool()} />);

    expect(screen.getByText("Waiting for a driver…")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 filled (33%)")).toBeInTheDocument();
  });

  it("advertises the pool discount only when a second passenger joins", () => {
    const shared = makeRidePool({ occupiedSeats: 2 });
    render(<PoolInfo pool={shared} />);

    expect(screen.getByText(/25% pool discount/i)).toBeInTheDocument();
    expect(screen.getByText("2 of 3 filled (67%)")).toBeInTheDocument();
  });

  it("keeps the discount off a solo ride", () => {
    render(<PoolInfo pool={makeRidePool()} />);
    expect(screen.queryByText(/pool discount/i)).not.toBeInTheDocument();
  });
});