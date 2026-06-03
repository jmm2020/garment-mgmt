import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch, login } from "../src/api/client.js";
import { ApiError } from "../src/api/types.js";

function mockResponse(status: number, body: unknown): Response {
  const text = body === null ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

describe("apiFetch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns parsed JSON on 200 success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { id: 1, ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ id: number; ok: boolean }>("GET", "/api/batches");

    expect(result).toEqual({ id: 1, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/batches",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("401 response throws ApiError with code from body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(401, {
          error: { code: "auth.unauthorized", message: "Authentication required" },
        }),
      ),
    );

    await expect(apiFetch("GET", "/api/batches")).rejects.toMatchObject({
      code: "auth.unauthorized",
      status: 401,
    });

    const err = await apiFetch("GET", "/api/batches").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("auth.unauthorized");
    expect((err as ApiError).status).toBe(401);
  });

  it("404 throws ApiError with not_found code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(404, { error: { code: "not_found", message: "batch 42 not found" } }),
      ),
    );

    const err = await apiFetch("GET", "/api/batches/42").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("not_found");
    expect((err as ApiError).status).toBe(404);
  });

  it("network failure (fetch rejects) propagates as-is", async () => {
    const boom = new Error("network down");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(boom));

    await expect(apiFetch("GET", "/api/batches")).rejects.toBe(boom);
  });

  it("login() calls POST /auth/login with credentials:include", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await login("user@example.com", "secret");

    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
      }),
    );
  });
});
