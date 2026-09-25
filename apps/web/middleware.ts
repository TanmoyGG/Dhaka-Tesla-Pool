// Clerk middleware for Next.js 15 (App Router).
//
// Policy for this phase:
//   PUBLIC   / , /sign-in(.*), /sign-up(.*)
//   PROTECTED /account(.*)          -> redirects to sign-in when signed out
//   /health lives on the Fastify API (different origin/port) and stays public.
//
// Application route policy is documented in docs/architecture.md §3.4.

import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/account(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    const { userId } = await auth();
    if (!userId) {
      // Deterministic local redirect for signed-out users. An explicit
      // redirect keeps the route policy independent of Clerk's dev-browser
      // "protect-rewrite" fallback, which targets the Clerk-hosted sign-in
      // and 404s in the build-only/placeholder reproduction. With a live
      // Clerk instance the two behave identically for signed-out visitors.
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }
  }
});

export const config = {
  // Run the middleware everywhere except Next.js internals and static files
  // (the standard Clerk matcher for App Router).
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};