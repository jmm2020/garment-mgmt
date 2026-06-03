import { ApiError, type ApiErrorBody } from "./types.js";

/**
 * Empty base — URLs are relative. In dev the Vite proxy forwards `/api` and
 * `/auth` to localhost:3000; in prod the web bundle is served same-origin as
 * the API, so relative paths resolve correctly without a proxy.
 */
const BASE = "";

/**
 * Typed fetch wrapper mirroring the CLI `request()` (packages/cli/src/lib/request.ts):
 * same error-envelope parse, but the browser uses `credentials: 'include'` so the
 * httpOnly session cookie (gm_sid) is sent instead of an explicit cookie header.
 */
export async function apiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const envelope = data as ApiErrorBody | null;
    const code = envelope?.error?.code ?? "unknown";
    const message = envelope?.error?.message ?? res.statusText;
    throw new ApiError(code, message, res.status, envelope?.error?.details);
  }

  return data as T;
}

export function get<T>(path: string): Promise<T> {
  return apiFetch<T>("GET", path);
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>("POST", path, body);
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>("PATCH", path, body);
}

export function del<T>(path: string): Promise<T> {
  return apiFetch<T>("DELETE", path);
}

/** Authenticate against the server. Sets the session cookie on success. */
export async function login(email: string, password: string): Promise<void> {
  await post("/auth/login", { email, password });
}
