import { formatStatus, formatDateTime } from "@/lib/format";
import { isTerminal, type RideStatus } from "@/lib/types";

// Renders the fixed PRD lifecycle for the current status. Terminal COMPLETED
// shows the full chain (green at the end); CANCELLED renders a single red
// step — the ride did not happen. This is the SAME state machine the backend
// enforces (apps/api/src/rides/state.ts); the UI only ever displays it.
const TIMELINE_STEPS: RideStatus[] = [
  "REQUESTED",
  "MATCHED",
  "DRIVER_ARRIVED",
  "STARTED",
  "COMPLETED",
];

export function StatusTimeline({
  status,
  updatedAt,
}: {
  status: RideStatus;
  updatedAt: string;
}) {
  if (status === "CANCELLED") {
    return (
      <ol className="timeline" aria-label="Ride status">
        <li className="timeline-item cancelled">
          <div className="timeline-marker">
            <span className="timeline-dot" />
          </div>
          <div className="timeline-label">
            <strong>Cancelled</strong>
            <em>{formatDateTime(updatedAt)}</em>
          </div>
        </li>
      </ol>
    );
  }

  const currentIndex = TIMELINE_STEPS.indexOf(status);

  return (
    <ol className="timeline" aria-label="Ride status">
      {TIMELINE_STEPS.map((step, index) => {
        const isReached = index <= currentIndex;
        const isCurrent = index === currentIndex;
        const isDone =
          isTerminal(status) && status === "COMPLETED" && index === currentIndex;
        const className = [
          "timeline-item",
          isReached ? "reached" : "next",
          isDone ? "completed" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={step} className={className}>
            <div className="timeline-marker">
              <span className="timeline-dot" />
              {index < TIMELINE_STEPS.length - 1 && (
                <span className="timeline-line" />
              )}
            </div>
            <div className="timeline-label">
              <strong>{formatStatus(step)}</strong>
              {isCurrent && <em>current</em>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}