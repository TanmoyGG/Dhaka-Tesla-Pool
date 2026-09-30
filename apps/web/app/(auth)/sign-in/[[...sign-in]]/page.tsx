"use client";

import { useRef } from "react";
import { SignIn } from "@clerk/nextjs";
import { SignInDemoAutofill } from "@/components/sign-in-demo-autofill";

// Catch-all path-routed sign-in (Clerk's documented App Router structure).
// `routing="path"` + `path` makes the component own every step of the flow
// under /sign-in on THIS origin; `signUpUrl` points the "create an account"
// link at our /sign-up instead of the accounts.dev instance URL;
// `fallbackRedirectUrl="/"` lands the user on the landing page, where the
// role is resolved from the API and the user is sent to their workspace.
// The cross-navigation links are Clerk-owned, so no manual <Link>s here.
//
// Client-side only because the demo auto-fill needs a ref to the card that
// Clerk renders into; Clerk's <SignIn> was already a client component.
export default function SignInPage() {
  const cardRef = useRef<HTMLElement>(null);

  return (
    <section className="auth-card" ref={cardRef}>
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/"
      />
      <SignInDemoAutofill cardRef={cardRef} />
    </section>
  );
}
