"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { AppMenu } from "./app-menu";

// Product shell: minimal sticky header — brand left, the signed-in user's
// identity centered, hamburger right (docs/frontend-design.md §7). Routing and
// roles are protected by the middleware + RoleGate; this header is navigation
// convenience only, never a security layer.
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useUser();

  // Identity comes from Clerk's own session object (identity-correct by
  // construction, no cache to go stale). Prefer the username (Nusrat, Jashim),
  // then the display name, then the primary email as the last resort.
  const identity =
    user?.username ??
    user?.fullName ??
    user?.primaryEmailAddress?.emailAddress ??
    null;

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <Link className="brand" href="/">
            Dhaka <span className="brand-accent">Tesla</span> Pool
          </Link>

          <div className="site-header-current" aria-hidden={!identity}>
            {identity}
          </div>

          <AppMenu />
        </div>
      </header>

      {children}
    </>
  );
}