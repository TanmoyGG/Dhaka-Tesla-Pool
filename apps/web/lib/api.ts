// Minimal client-side API client. Every request carries the Clerk session
// token as a Bearer token so the Fastify API can verify identity. The API
// never trusts a userId or role supplied in a request body — identity always
// derives from the verified token.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export async function apiGet<T>(
  path: string,
  getToken: () => Promise<string | null>,
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    const body: { error?: { code?: string; message?: string } } | null =
      await res.json().catch(() => null);
    throw new ApiError(
      body?.error?.code ?? `HTTP_${res.status}`,
      body?.error?.message ?? `Request failed with status ${res.status}`,
    );
  }

  return (await res.json()) as T;
}