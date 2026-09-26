"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/queries";
import { ErrorCard, LoadingState } from "./state-components";
import type { UserRole } from "@/lib/types";

// Client-side role gate. The backend enforces roles on every request — this
// only shapes the UX: redirect the wrong role away instead of showing forms
// that would 403. A DRIVER who opens /rides lands on /driver (and vice versa).
// `allow` is the full allowed set; PASSENGER pages never admit DRIVERs.
export function RoleGate({
  roles,
  fallback,
  children,
}: {
  roles: UserRole[];
  fallback: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const me = useMe();
  const allowed = me.data ? roles.includes(me.data.role) : false;

  useEffect(() => {
    if (me.isSuccess && !allowed) {
      router.replace(fallback);
    }
  }, [me.isSuccess, allowed, router, fallback]);

  if (me.isLoading) {
    return (
      <div className="container">
        <LoadingState label="Checking your access…" />
      </div>
    );
  }

  if (me.isError) {
    return (
      <div className="container">
        <h1 className="page-header">Access check</h1>
        <ErrorCard error={me.error} />
      </div>
    );
  }

  // Redirect is handled in the effect above; render nothing meanwhile to avoid
  // a flash of the wrong-role UI.
  if (!allowed) return null;

  return <>{children}</>;
}