"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useMe } from "@/lib/queries";
import { ErrorCard } from "@/components/state-components";
import { CredentialsModal } from "@/components/credentials-modal";

const REPO_URL = "https://github.com/TanmoyGG/Dhaka-Tesla-Pool";

// Public landing. Signed-out visitors get the pitch and the two auth entry
// points. Signed-in users are never shown the landing page: the role is
// resolved from the API (/api/me) and the browser is sent straight to the
// workspace — DRIVER → /driver, PASSENGER|ADMIN → /rides. No intermediate
// dashboard or role-aware quick-path toggle (see docs/frontend-design.md §3).
export default function HomePage() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const me = useMe();
  const role = me.data?.role;
  // Public demo credentials (frontend-design.md §6.6). Signed-out visitors
  // only — a signed-in user is redirected to their workspace and never sees it.
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const closeCredentials = useCallback(() => setCredentialsOpen(false), []);

  useEffect(() => {
    if (isLoaded && isSignedIn && me.isSuccess && role) {
      router.replace(role === "DRIVER" ? "/driver" : "/rides");
    }
  }, [isLoaded, isSignedIn, me.isSuccess, role, router]);

  if (!isLoaded || isSignedIn) {
    if (isSignedIn && me.isError) {
      return (
        <main className="container">
          <ErrorCard error={me.error} />
        </main>
      );
    }
    return (
      <div className="landing-redirect" aria-live="polite">
        <span className="text-muted">Taking you to your workspace…</span>
      </div>
    );
  }

  return (
    <main className="container landing">
      <a
        className="github-corner"
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        GitHub ↗
      </a>

      <h1 className="landing-title" aria-label="Dhaka Tesla Pool">
        <span className="landing-word">Dhaka</span>{" "}
        <span className="landing-word landing-tesla" style={{ animationDelay: "60ms" }}>
          Tesla
        </span>{" "}
        <span
          className="landing-word landing-accent"
          style={{ animationDelay: "120ms" }}
        >
          Pool
        </span>
      </h1>

      <p className="landing-tagline">
        Share a seat. Split the fare. Survive Dhaka traffic.
      </p>
      <p className="landing-subline">
        Three-seat Teslas. Predefined Dhaka zones. Every pooled seat pays 25%
        less.
      </p>

      <nav aria-label="Get started" className="landing-actions">
        <Link className="btn btn-primary" href="/sign-up">
          Create an account
        </Link>
        <Link className="btn btn-secondary" href="/sign-in">
          Sign in
        </Link>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setCredentialsOpen(true)}
        >
          Credentials for Testing
        </button>
      </nav>

      <CredentialsModal open={credentialsOpen} onClose={closeCredentials} />
    </main>
  );
}