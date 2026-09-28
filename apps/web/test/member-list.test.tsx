// MemberList on the driver surface: passengers on board (ACTIVE members only)
// with their names, seats, zones, and the per-passenger fare rendered verbatim
// from the backend `member.fare` — never recomputed.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemberList } from "@/components/driver/member-list";
import { makeDriverMember } from "./fixtures";

describe("MemberList", () => {
  it("hints when no passengers are on board", () => {
    render(<MemberList members={[]} />);
    expect(
      screen.getByText("No passengers confirmed on this trip."),
    ).toBeInTheDocument();
  });

  it("shows name, seats, route, and the passenger fare", () => {
    render(
      <MemberList
        members={[
          makeDriverMember(),
          makeDriverMember({
            passengerName: "Rafiq Chowdhury",
            destinationZoneName: "Gulshan 1",
            seats: 2,
            fare: { currency: "BDT", perSeatFarePaisa: 4140, totalPaisa: 8280 },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Nusrat Haque")).toBeInTheDocument();
    expect(screen.getByText("· 1 seat · Banani → Mohakhali")).toBeInTheDocument();
    expect(screen.getByText("· ৳59.32")).toBeInTheDocument();

    expect(screen.getByText("Rafiq Chowdhury")).toBeInTheDocument();
    expect(screen.getByText("· 2 seats · Banani → Gulshan 1")).toBeInTheDocument();
    expect(screen.getByText("· ৳82.80")).toBeInTheDocument();
  });
});