// Client-side API client. Every request carries the Clerk session token as a
// Bearer token so the Fastify API can verify identity. The API never trusts a
// userId or role supplied in a request body — identity always derives from the
// verified token.
//
// The Fastify error envelope is `{ error: { code, message, details? } }`; any
// non-2xx response is surfaced as an ApiError carrying the server's code.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

type ApiErrorBody = { error?: { code?: string; message?: string } } | null;

async function parseErrorResponse(res: Response): Promise<ApiError> {
  const body: ApiErrorBody = await res.json().catch(() => null);
  return new ApiError(
    body?.error?.code ?? `HTTP_${res.status}`,
    body?.error?.message ?? `Request failed with status ${res.status}`,
  );
}

// Shared request helper: obtains the bearer token, performs the fetch, and
// normalizes non-2xx responses into ApiError. Kept private so callers use the
// typed apiGet/apiPost wrappers.
async function request<T>(
  method: "GET" | "POST",
  path: string,
  getToken: () => Promise<string | null>,
  body?: unknown,
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return (await res.json()) as T;
}

export async function apiGet<T>(
  path: string,
  getToken: () => Promise<string | null>,
): Promise<T> {
  return request<T>("GET", path, getToken);
}

export async function apiPost<T>(
  path: string,
  getToken: () => Promise<string | null>,
  body?: unknown,
): Promise<T> {
  return request<T>("POST", path, getToken, body);
}

// Maps an ApiError to a user-facing message. Non-ApiError failures get a
// generic fallback. INVALID_STATE_TRANSITION is a normal race condition in
// the pooled ride domain (e.g. the driver started the ride between render
// and submit), so it gets a calm, actionable message instead of the raw code.
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INVALID_STATE_TRANSITION") {
      return "This ride changed before the action finished. Refresh to see the current status, then try again.";
    }
    if (error.code === "FORBIDDEN") {
      return "You do not have permission to do that.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}