import { describeApiError } from "@/lib/api";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status">
      <p className="text-muted">{label}</p>
      <span className="skeleton" aria-hidden="true" />
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="text-muted">{message}</p>;
}

export function ErrorCard({ error }: { error: unknown }) {
  return (
    <div className="notice notice-error" role="alert">
      <p>{describeApiError(error)}</p>
    </div>
  );
}