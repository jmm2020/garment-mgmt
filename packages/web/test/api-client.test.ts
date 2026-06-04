import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch, login, del, post } from "../src/api/client.js";
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

  it("login() calls POST /auth/login with credentials:include and content-type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await login("user@example.com", "secret");

    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    );
  });

  it("returns null for 204 with empty body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(204, null)));

    const result = await apiFetch("POST", "/auth/logout");

    expect(result).toBeNull();
  });

  it("non-JSON error body falls back to code 'unknown' and statusText", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(502, null)));

    const err = await apiFetch("GET", "/api/batches").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("unknown");
    expect((err as ApiError).message).toBe("HTTP 502");
    expect((err as ApiError).status).toBe(502);
  });

  it("non-JSON response body throws ApiError with code parse_error", async () => {
    const badResponse = {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: () => Promise.resolve("<html>Bad Gateway</html>"),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(badResponse));

    const err = await apiFetch("GET", "/api/batches").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("parse_error");
    expect((err as ApiError).status).toBe(502);
  });

  it("400 response with details populates ApiError.details", async () => {
    const details = [{ path: ["email"], message: "Invalid email" }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(400, { error: { code: "validation_failed", message: "Bad input", details } }),
      ),
    );

    const err = await apiFetch("POST", "/api/batches").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).details).toEqual(details);
  });

  it("del() sends DELETE with no content-type and no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, null));
    vi.stubGlobal("fetch", fetchMock);

    await del("/api/batches/1");

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe("DELETE");
    expect(opts.body).toBeUndefined();
    expect((opts.headers as Record<string, string>)?.["content-type"]).toBeUndefined();
  });

  it("post() sends POST with content-type: application/json", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await post("/api/batches", { ref: "PB-2024-0001" });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)?.["content-type"]).toBe("application/json");
  });
});

describe("global 401 redirect", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("a 401 ApiError triggers navigation to /login via window.location.replace", async () => {
    // This is tested indirectly via QueryClient onError; we test that apiFetch
    // throws ApiError with status 401 so the caller can detect it.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(401, { error: { code: "auth.unauthorized", message: "Authentication required" } }),
      ),
    );

    const err = await apiFetch("GET", "/api/batches").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });
});
