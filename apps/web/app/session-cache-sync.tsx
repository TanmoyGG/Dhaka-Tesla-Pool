"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef } from "react";

// Clears the entire TanStack cache whenever the authenticated Clerk user
// changes (including logout → null). Combined with per-user query keys in
// lib/queries.ts, this guarantees no data from a previous session survives:
// cancellations stop in-flight fetches from the old identity, and eviction
// frees memory + removes stale entries before layout effects repaint.
export function SessionCacheSync() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const previousUserId = useRef(userId);

  useEffect(() => {
    if (previousUserId.current !== userId) {
      previousUserId.current = userId;
      queryClient.clear();
    }
  }, [userId, queryClient]);

  return null;
}