"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { SessionCacheSync } from "./session-cache-sync";

// Simple, predictable cache behavior for the passenger UI:
// - staleTime 30s: fresh data is reused briefly, then refetched on focus.
// - retry 1: transient failures get one retry; hard errors (4xx/409) surface
//   to the UI quickly instead of being retried indefinitely.
// SessionCacheSync clears the cache whenever the Clerk user changes, so no
// data is ever carried across logout/login or between different users.
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <SessionCacheSync />
      {children}
    </QueryClientProvider>
  );
}