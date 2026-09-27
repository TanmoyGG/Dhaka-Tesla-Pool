"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { ErrorCard, LoadingState } from "@/components/state-components";
import { useMe } from "@/lib/queries";

export default function AccountPage() {
  const me = useMe();

  return (
    <main className="container">
      <h1 className="page-header">Your account</h1>

      <div className="card">
        <div className="row space-between">
          <p className="text-muted">
            Identity from Clerk; role from the application database
            (PostgreSQL), granted by the project owner.
          </p>
          <UserButton />
        </div>

        {me.isLoading && <LoadingState label="Loading your profile…" />}
        {me.isError && <ErrorCard error={me.error} />}

        {me.data && (
          <dl className="dl">
            <div>
              <dt>Name</dt>
              <dd>{me.data.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{me.data.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{me.data.role}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{me.data.active ? "Yes" : "No"}</dd>
            </div>
          </dl>
        )}
      </div>

      <nav aria-label="Quick links" className="row">
        {me.data?.role === "DRIVER" && (
          <Link className="btn btn-secondary" href="/driver">
            Driver hub
          </Link>
        )}
        {(me.data?.role === "PASSENGER" || me.data?.role === "ADMIN") && (
          <Link className="btn btn-secondary" href="/rides">
            Book a ride
          </Link>
        )}
      </nav>
    </main>
  );
}