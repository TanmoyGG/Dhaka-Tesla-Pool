"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { useMe } from "@/lib/queries";

// Public landing. Signed-in guests see a role-aware quick path (no stale
// "later phases" copy — the booking and driver flows are live); signed-out
// visitors get the pitch and auth entry points.
export default function HomePage() {
  const { isLoaded, isSignedIn } = useAuth();
  const me = useMe();
  const role = me.data?.role;

  return (
    <main className="container">
      <h1 className="page-header">Dhaka Tesla Pool</h1>
      <p className="text-muted">
        Share a seat. Split the fare. Survive Dhaka traffic.
      </p>

      <p>
        Predefined Dhaka zones. Every Tesla holds three seats and a battery.
        Book a ride, and if someone is heading your way, they join your pool —
        the fare splits automatically and everyone pays 25% less.
      </p>

      <ol>
        <li>Pick your pickup zone, destination, and seats.</li>
        <li>See your estimated fare before you book.</li>
        <li>Matched automatically to a Tesla (or an existing pool).</li>
        <li>The driver runs the trip; the app keeps the record.</li>
      </ol>

      {isLoaded && !isSignedIn ? (
        <nav aria-label="Get started" className="row">
          <SignInButton>
            <button type="button" className="btn btn-primary">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton>
            <button type="button" className="btn btn-secondary">
              Create an account
            </button>
          </SignUpButton>
        </nav>
      ) : (
        <nav aria-label="Go to your workspace" className="row">
          {role === "DRIVER" && (
            <Link className="btn btn-primary" href="/driver">
              Open driver hub
            </Link>
          )}
          {(role === "PASSENGER" || role === "ADMIN") && (
            <Link className="btn btn-primary" href="/rides">
              Book a ride
            </Link>
          )}
          {isSignedIn && (
            <Link className="btn btn-secondary" href="/account">
              Your account
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}