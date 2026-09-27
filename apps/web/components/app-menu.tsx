"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useMe } from "@/lib/queries";
import { menuItemsFor, type MenuItem } from "@/lib/navigation";

// Hamburger + right-side drawer (docs/frontend-design.md §7). The item set is
// role-aware via lib/navigation.ts and reflects ONLY the current user's role
// (useMe is keyed by the Clerk userId), so an identity change can never flash
// the previous session's menu. Sign out stays on Clerk's own flow — the env
// fallback redirect and SessionCacheSync query-clear perform the cleanup.
//
// The drawer is PORTALTED to <body>: the sticky header has `backdrop-filter`,
// which turns it into a containing block for `position: fixed` descendants —
// a drawer rendered inside the header would collapse to a clipped strip of the
// header's own box. Portaled, it is true viewport-level UI. It is also anchored
// BELOW the measured header (not over it) so the hamburger stays visible and
// doubles as the close control.
export function AppMenu() {
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const pathname = usePathname();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const role = me.isSuccess ? me.data?.role : undefined;
  const items = menuItemsFor(role);

  // Close on navigation — a destination click must never leave the drawer
  // hanging over the next page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock page scroll while the drawer is open (native sheet feel on mobile).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Measure the header BEFORE paint so the panel opens already below it (no
  // flicker at top:0). Auth pages have no .site-header; the drawer only ever
  // opens inside the app shell, so the measurement is always available.
  useLayoutEffect(() => {
    if (!open) return;
    const header = triggerRef.current?.closest(".site-header");
    setHeaderHeight(header?.getBoundingClientRect().height ?? 0);
  }, [open]);

  // Manage focus: first item on open, back to the trigger on close.
  useEffect(() => {
    if (open) {
      document
        .querySelector<HTMLAnchorElement | HTMLButtonElement>(".app-menu-item")
        ?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  if (!isSignedIn) return null;

  const handleSignOut = () => {
    setOpen(false);
    void signOut();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="menu-button"
        aria-expanded={open}
        aria-controls="app-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="menu-button-bar" />
        <span className="menu-button-bar" />
        <span className="menu-button-bar" />
      </button>

      {open &&
        createPortal(
          <div className="app-menu">
            <div className="app-menu-overlay" onClick={() => setOpen(false)} />
            <aside
              id="app-menu"
              className="app-menu-panel"
              style={{ top: headerHeight }}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
            >
              <nav aria-label="Primary" className="app-menu-nav">
                <ul className="app-menu-list">
                  {items.map((item) => (
                    <li key={item.label}>
                      <MenuItem
                        item={item}
                        isActive={isActive}
                        onSignOut={handleSignOut}
                      />
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  item,
  isActive,
  onSignOut,
}: {
  item: MenuItem;
  isActive: (href: string) => boolean;
  onSignOut: () => void;
}) {
  if (item.type === "action") {
    return (
      <button
        type="button"
        className="app-menu-item sign-out"
        onClick={onSignOut}
      >
        {item.label}
      </button>
    );
  }

  return (
    <Link
      className="app-menu-item"
      href={item.href}
      aria-current={isActive(item.href) ? "page" : undefined}
    >
      {item.label}
    </Link>
  );
}