import { formatStatus } from "@/lib/format";
import type { RideStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: RideStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      {formatStatus(status)}
    </span>
  );
}