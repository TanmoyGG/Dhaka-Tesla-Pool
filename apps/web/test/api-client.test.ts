// Regression for the driver availability toggle's "Unexpected end of JSON
// input": the shared request() helper must not JSON-parse a 204 No Content
// body. Empty 2xx responses resolve to undefined; normal JSON responses and
// the Fastify error envelope behave exactly as before.

import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPost } from "@/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(
  ok: boolean,
  status: number,
  body: { text: string; json: unknown },
) {
  const response = {
    ok,
    status,
    text: async () => body.text,
    json: async () => body.json,
  } as unknown as Response;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

const getToken = async () => "test-token";

describe("request() 2xx body handling", () => {
  it("resolves a 204 No Content response without parsing its empty body", async () => {
    stubFetch(true, 204, {
      text: "",
      json: () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });
    await expect(
      apiPost<void>("/api/driver/availability", getToken, { isOnline: false }),
    ).resolves.toBeUndefined();
  });

  it("returns parsed JSON for a normal 200 response", async () => {
    stubFetch(true, 200, {
      text: JSON.stringify({ user: { id: "u1" } }),
      json: { user: { id: "u1" } },
    });
    const out = await apiGet<{ user: { id: string } }>("/api/me", getToken);
    expect(out.user.id).toBe("u1");
  });

  it("still surfaces the server error envelope on a non-2xx response", async () => {
    stubFetch(false, 409, {
      text: JSON.stringify({
        error: { code: "POOL_ALREADY_ACCEPTED", message: "someone else won" },
      }),
      json: { error: { code: "POOL_ALREADY_ACCEPTED", message: "someone else won" } },
    });
    await expect(apiPost("/x", getToken)).rejects.toMatchObject({
      code: "POOL_ALREADY_ACCEPTED",
    });
  });
});