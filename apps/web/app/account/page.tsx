"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserButton, useAuth } from "@clerk/nextjs";
import { apiGet, ApiError } from "@/lib/api";

interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
  };
}

export default function AccountPage() {
  const { isLoaded, getToken } = useAuth();
  const [user, setUser] = useState<MeResponse["user"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isLoaded) return;
      try {
        const me = await apiGet<MeResponse>("/api/me", getToken);
        if (!cancelled) setUser(me.user);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? `${err.code}: ${err.message}`
              : err instanceof Error
                ? err.message
                : "Something went wrong",
          );
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, getToken]);

  return (
    <main>
      <h1>Your account</h1>
      <UserButton />
      <p>
        This identity is provided by Clerk; the role shown below is stored in
        the application database (PostgreSQL) and granted by the project owner.
      </p>

      {error && <p style={{ color: "red" }}>Error: {error}</p>}

      {user ? (
        <dl>
          <dt>Name</dt>
          <dd>{user.name}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>{user.role}</dd>
          <dt>Active</dt>
          <dd>{user.active ? "yes" : "no"}</dd>
        </dl>
      ) : (
        !error && <p>Loading…</p>
      )}

      <p>
        <Link href="/">Back to home</Link>
      </p>
    </main>
  );
}