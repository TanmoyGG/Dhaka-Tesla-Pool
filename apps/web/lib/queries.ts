// TanStack Query hooks. Each hook derives the Clerk bearer token from
// useAuth() at fetch time and invalidates the relevant query family after
// mutations so the list, the detail, and the booking result stay consistent.
//
// Polling: queries on non-terminal rides/pools use the `refetchInterval`
// FUNCTION pattern — they poll while ANY returned item is still active and
// STOP as soon as everything is COMPLETED/CANCELLED (no pointless long-poll).
// The (rare) non-2xx error retains the previous data, so a transient blip
// does not kick the dashboard into loading again.

"use client";

import { useAuth } from "@clerk/nextjs";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiGet, apiPost } from "./api";
import type {
  DriverAvailabilityResponse,
  DriverPoolResponse,
  DriverPoolsResponse,
  EstimateResponse,
  FareView,
  MeResponse,
  RideView,
  RideResponse,
  RidesResponse,
  ZoneView,
  ZonesResponse,
} from "./types";
import { isTerminal, type RideStatus } from "./types";

export interface CreateRideInput {
  pickupZoneId: string;
  destinationZoneId: string;
  requestedSeats: number;
}

// Active = still changing. Once every item is terminal the ride is over and
// polling is pointless.
function pollWhileActive(second = 5000) {
  return (query: { state: { data: unknown } }): number | false => {
    const data = query.state.data;
    if (!data) return second;
    const items = (Array.isArray(data) ? data : [data]) as Array<{
      status: RideStatus;
    }>;
    return items.some((item) => !isTerminal(item.status)) ? second : false;
  };
}

export function useMe() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  return useQuery({
    enabled: isLoaded && Boolean(isSignedIn),
    queryKey: ["me"],
    queryFn: async (): Promise<MeResponse["user"]> => {
      const response = await apiGet<MeResponse>("/api/me", getToken);
      return response.user;
    },
  });
}

export function useZones() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["zones"],
    queryFn: async (): Promise<ZoneView[]> => {
      const response = await apiGet<ZonesResponse>("/api/zones", getToken);
      return response.zones;
    },
  });
}

export function useRides() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["rides"],
    queryFn: async (): Promise<RideView[]> => {
      const response = await apiGet<RidesResponse>("/api/rides", getToken);
      return response.rides;
    },
    refetchInterval: pollWhileActive(),
  });
}

export function useRide(rideId: string | undefined) {
  const { getToken } = useAuth();
  return useQuery({
    enabled: Boolean(rideId),
    queryKey: ["rides", rideId ?? "none"],
    queryFn: async (): Promise<RideView> => {
      const response = await apiGet<RideResponse>(`/api/rides/${rideId}`, getToken);
      return response.ride;
    },
    refetchInterval: pollWhileActive(),
  });
}

export function useCreateRide() {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateRideInput): Promise<RideView> => {
      // Idempotency key (ADR-015): generated exactly once per submit — one
      // POST gets one key, so an identical retry cannot create a duplicate
      // ride. The API answers 201 for a fresh ride and 200 for an idempotent
      // replay of an existing ride; both are treated as success here.
      const clientRequestId = crypto.randomUUID();
      const response = await apiPost<RideResponse>(
        "/api/rides",
        getToken,
        { ...input, clientRequestId },
      );
      return response.ride;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rides"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useCancelRide() {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (rideId: string): Promise<RideView> => {
      const response = await apiPost<RideResponse>(
        `/api/rides/${rideId}/cancel`,
        getToken,
      );
      return response.ride;
    },
    onSuccess: (ride) => {
      queryClient.invalidateQueries({ queryKey: ["rides"] });
      queryClient.invalidateQueries({ queryKey: ["rides", ride.id] });
    },
  });
}

export interface EstimateInput {
  pickupZoneId: string;
  destinationZoneId: string;
  requestedSeats: number;
}

// Live "see estimated fare before booking" (PRD): queried once the form is
// fully valid, refetched on future stale/focus. Nothing is created.
export function useEstimateRide(input: EstimateInput | null) {
  const { getToken } = useAuth();
  return useQuery({
    enabled: Boolean(input),
    queryKey: [
      "rides",
      "estimate",
      input?.pickupZoneId ?? "none",
      input?.destinationZoneId ?? "none",
      input?.requestedSeats ?? "none",
    ],
    queryFn: async (): Promise<FareView> => {
      const query = new URLSearchParams({
        pickupZoneId: input!.pickupZoneId,
        destinationZoneId: input!.destinationZoneId,
        requestedSeats: String(input!.requestedSeats),
      });
      const response = await apiGet<EstimateResponse>(
        `/api/rides/estimate?${query.toString()}`,
        getToken,
      );
      return response.fare;
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Driver hub queries
// ---------------------------------------------------------------------------

export function useDriverAvailability() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["driver", "availability"],
    queryFn: async (): Promise<{ isOnline: boolean }> => {
      const response = await apiGet<DriverAvailabilityResponse>(
        "/api/driver/availability",
        getToken,
      );
      return response.availability;
    },
  });
}

export function useSetAvailability() {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (isOnline: boolean): Promise<void> => {
      await apiPost<void>("/api/driver/availability", getToken, { isOnline });
    },
    onSuccess: (_, isOnline) => {
      queryClient.setQueryData<{ isOnline: boolean }>(
        ["driver", "availability"],
        { isOnline },
      );
      queryClient.invalidateQueries({ queryKey: ["driver", "availability"] });
    },
  });
}

export function useDriverPools() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["driver", "pools"],
    queryFn: async () => {
      const response = await apiGet<DriverPoolsResponse>(
        "/api/driver/pools",
        getToken,
      );
      return response.pools;
    },
    refetchInterval: pollWhileActive(),
  });
}

// The driver lobby (ADR-022): every UNASSIGNED MATCHED pool waiting for an
// eligible driver to claim it first-wins, newest first. Blocking live by
// construction — the lobby shrinks the moment any driver accepts.
export function useAvailablePools() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["driver", "pools", "available"],
    queryFn: async () => {
      const response = await apiGet<DriverPoolsResponse>(
        "/api/driver/pools/available",
        getToken,
      );
      return response.pools;
    },
    refetchInterval: pollWhileActive(),
  });
}

export function useDriverPool(poolId: string | undefined) {
  const { getToken } = useAuth();
  return useQuery({
    enabled: Boolean(poolId),
    queryKey: ["driver", "pools", poolId ?? "none"],
    queryFn: async () => {
      const response = await apiGet<DriverPoolResponse>(
        `/api/driver/pools/${poolId}`,
        getToken,
      );
      return response.pool;
    },
    refetchInterval: pollWhileActive(),
  });
}

// Completed-trip history is immutable — no polling.
export function useDriverHistory() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["driver", "pools", "history"],
    queryFn: async () => {
      const response = await apiGet<DriverPoolsResponse>(
        "/api/driver/pools/history",
        getToken,
      );
      return response.pools;
    },
  });
}

export type DriverPoolAction = "accept" | "arrive" | "start" | "complete";

function useDriverPoolAction(action: DriverPoolAction) {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (poolId: string) => {
      const response = await apiPost<DriverPoolResponse>(
        `/api/driver/pools/${poolId}/${action}`,
        getToken,
      );
      return response.pool;
    },
    onSuccess: (pool) => {
      queryClient.invalidateQueries({ queryKey: ["driver", "pools"] });
      queryClient.invalidateQueries({ queryKey: ["driver", "pools", pool.id] });
      queryClient.invalidateQueries({ queryKey: ["driver", "pools", "history"] });
      // Accepting drains the lobby; the prefix above already covers it, but
      // the explicit key keeps the intent visible (ADR-022).
      queryClient.invalidateQueries({
        queryKey: ["driver", "pools", "available"],
      });
    },
  });
}

export function useAcceptPool() {
  return useDriverPoolAction("accept");
}

export function useArrivePool() {
  return useDriverPoolAction("arrive");
}

export function useStartPool() {
  return useDriverPoolAction("start");
}

export function useCompletePool() {
  return useDriverPoolAction("complete");
}