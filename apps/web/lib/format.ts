// Display formatters for the passenger UI. Money is integer paisa on the API
// (never floating point); formatPaisa converts to BDT with 2 decimal places.

import type { RideStatus } from "./types";

export function formatPaisa(paisa: number): string {
  const taka = paisa / 100;
  return `৳${taka.toFixed(2)}`;
}

const STATUS_LABELS: Record<RideStatus, string> = {
  REQUESTED: "Requested",
  MATCHED: "Matched",
  DRIVER_ARRIVED: "Driver arrived",
  STARTED: "Started",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function formatStatus(status: RideStatus): string {
  return STATUS_LABELS[status];
}