import { ApiError, type ApiErrorBody } from "./types.js";

// URLs are relative — Vite proxy forwards /api + /auth to :3000 in dev; same-origin in prod.
// credentials:"include" sends the httpOnly session cookie (gm_sid) automatically.
export async function apiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError("parse_error", "Server returned a non-JSON response", res.status);
    }
  }

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

export function del(path: string): Promise<void> {
  return apiFetch<void>("DELETE", path);
}

/** Authenticate against the server. Sets the session cookie on success. */
export async function login(email: string, password: string): Promise<void> {
  await post("/auth/login", { email, password });
}

/** Sign out and invalidate the server session cookie. */
export async function logout(): Promise<void> {
  await post<void>("/auth/logout");
}
