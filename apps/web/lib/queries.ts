// TanStack Query hooks for the passenger flows. Each hook derives the Clerk
// bearer token from useAuth() at fetch time and invalidates the ["rides"]
// query family after mutations so the list, the detail, and the booking
// result all stay consistent.
//
// No polling timers: the UI relies on the default stale/refetch-on-focus
// behavior configured in app/providers.tsx.

"use client";

import { useAuth } from "@clerk/nextjs";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiGet, apiPost } from "./api";
import type {
  RideView,
  RideResponse,
  RidesResponse,
  ZoneView,
  ZonesResponse,
} from "./types";

export interface CreateRideInput {
  pickupZoneId: string;
  destinationZoneId: string;
  requestedSeats: number;
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rides"] });
    },
  });
}