"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import { useMe } from "@/lib/queries";

// Product shell: sticky header with role-aware navigation. The link set is
// purely navigational convenience — the middleware protects every private
// route and the backend re-verifies roles on each request.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  const me = useMe();
  const role = me.data?.role;

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <Link className="brand" href="/">
            Dhaka <span className="brand-accent">Tesla</span> Pool
          </Link>

          <nav className="main-nav" aria-label="Primary">
            {isSignedIn && role === "DRIVER" && (
              <Link
                href="/driver"
                aria-current={isActive("/driver") ? "page" : undefined}
              >
                Driver hub
              </Link>
            )}
            {isSignedIn && role === "PASSENGER" && (
              <Link
                href="/rides"
                aria-current={isActive("/rides") ? "page" : undefined}
              >
                Book a ride
              </Link>
            )}
            {isSignedIn && role === "ADMIN" && (
              <>
                <Link
                  href="/rides"
                  aria-current={isActive("/rides") ? "page" : undefined}
                >
                  Book a ride
                </Link>
                <Link
                  href="/driver"
                  aria-current={isActive("/driver") ? "page" : undefined}
                >
                  Driver hub
                </Link>
              </>
            )}
            {isSignedIn && (
              <Link
                href="/account"
                aria-current={isActive("/account") ? "page" : undefined}
              >
                Account
              </Link>
            )}
            {!isSignedIn && (
              <span className="nav-auth">
                <SignInButton>
                  <button type="button" className="btn btn-ghost btn-sm">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton>
                  <button type="button" className="btn btn-primary btn-sm">
                    Sign up
                  </button>
                </SignUpButton>
              </span>
            )}
          </nav>

          {isSignedIn && (
            <div className="header-user">
              <UserButton />
            </div>
          )}
        </div>
      </header>

      {children}
    </>
  );
}