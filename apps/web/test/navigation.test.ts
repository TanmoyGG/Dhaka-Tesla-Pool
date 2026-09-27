// Role-aware menu mapping (docs/frontend-design.md §7). Guards the Phase 2
// invariant that passenger-specific navigation never reaches drivers and vice
// versa, and that an unresolved role renders only role-agnostic items.

import { describe, expect, it } from "vitest";
import { menuItemsFor, ROUTES } from "@/lib/navigation";

const linkLabels = (role: Parameters<typeof menuItemsFor>[0]) =>
  menuItemsFor(role).map((item) => item.label);

describe("menuItemsFor", () => {
  it("gives passengers the rides workspace and ride history only", () => {
    const items = menuItemsFor("PASSENGER");

    expect(items).toEqual([
      { type: "link", label: "Book a ride", href: ROUTES.passenger },
      { type: "link", label: "Ride history", href: ROUTES.passengerHistory },
      { type: "link", label: "Account", href: ROUTES.account },
      { type: "action", label: "Sign out", action: "sign-out" },
    ]);
  });

  it("gives drivers the driver workspace and trip history only", () => {
    const items = menuItemsFor("DRIVER");

    expect(items).toEqual([
      { type: "link", label: "Driver workspace", href: ROUTES.driver },
      { type: "link", label: "Trip history", href: ROUTES.driverHistory },
      { type: "link", label: "Account", href: ROUTES.account },
      { type: "action", label: "Sign out", action: "sign-out" },
    ]);
  });

  it("gives admins both workspaces and both histories", () => {
    const items = menuItemsFor("ADMIN");

    expect(linkLabels("ADMIN")).toEqual([
      "Book a ride",
      "Ride history",
      "Driver workspace",
      "Trip history",
      "Account",
      "Sign out",
    ]);
    expect(items).toBeDefined();
  });

  it("never leaks the other role's items", () => {
    const passenger = linkLabels("PASSENGER");
    const driver = linkLabels("DRIVER");

    expect(passenger).not.toContain("Driver workspace");
    expect(passenger).not.toContain("Trip history");
    expect(driver).not.toContain("Book a ride");
    expect(driver).not.toContain("Ride history");
  });

  it("renders only role-agnostic items while the role is unresolved", () => {
    expect(linkLabels(undefined)).toEqual(["Account", "Sign out"]);
  });
});