// Role-aware navigation for the app menu (docs/frontend-design.md §7).
//
// This is the SINGLE source of truth for what a signed-in user can reach from
// the header menu. Menu items are links (navigational convenience only — the
// middleware and RoleGate still own route/role protection, never this config)
// plus one sign-out action that stays on Clerk's own flow.
//
// Phase 1 isolation invariant: the caller passes the CURRENT user's role
// (useMe, keyed by the Clerk userId) into menuItemsFor. While a role is not
// resolved (loading / identity transition) only role-agnostic items (Account,
// Sign out) render — another role's workspace items can never flash.
//
// History lives on dedicated, deep-linkable routes behind the same protection
// as the workspaces — the passenger and driver workspaces no longer embed
// history sections.

import type { UserRole } from "./types";

export const ROUTES = {
  passenger: "/rides",
  passengerHistory: "/rides/history",
  driver: "/driver",
  driverHistory: "/driver/history",
  account: "/account",
} as const;

export type MenuItem =
  | { type: "link"; label: string; href: string }
  | { type: "action"; label: string; action: "sign-out" };

const accountItem: MenuItem = { type: "link", label: "Account", href: ROUTES.account };
const signOutItem: MenuItem = { type: "action", label: "Sign out", action: "sign-out" };

export function menuItemsFor(role: UserRole | undefined): MenuItem[] {
  switch (role) {
    case "PASSENGER":
      return [
        { type: "link", label: "Book a ride", href: ROUTES.passenger },
        { type: "link", label: "Ride history", href: ROUTES.passengerHistory },
        accountItem,
        signOutItem,
      ];
    case "DRIVER":
      return [
        { type: "link", label: "Driver workspace", href: ROUTES.driver },
        { type: "link", label: "Trip history", href: ROUTES.driverHistory },
        accountItem,
        signOutItem,
      ];
    case "ADMIN":
      // Preserves the historical ADMIN surface: both workspaces are reachable.
      return [
        { type: "link", label: "Book a ride", href: ROUTES.passenger },
        { type: "link", label: "Ride history", href: ROUTES.passengerHistory },
        { type: "link", label: "Driver workspace", href: ROUTES.driver },
        { type: "link", label: "Trip history", href: ROUTES.driverHistory },
        accountItem,
        signOutItem,
      ];
    default:
      // Role not resolved yet — only role-agnostic items render.
      return [accountItem, signOutItem];
  }
}