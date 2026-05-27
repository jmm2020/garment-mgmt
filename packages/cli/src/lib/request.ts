import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const SESSION_DIR = join(homedir(), ".garment-mgmt");
const SESSION_FILE = join(SESSION_DIR, "session");

export const DEFAULT_HOST = process.env.GM_HOST ?? "http://localhost:3000";

export interface Session {
  host: string;
  cookie: string;
}

export function loadSession(): Session | null {
  try {
    const raw = readFileSync(SESSION_FILE, "utf8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  mkdirSync(dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(s), { mode: 0o600 });
}

export async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const session = loadSession();
  const host = session?.host ?? DEFAULT_HOST;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (session?.cookie) headers.cookie = session.cookie;

  const res = await fetch(`${host}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = (data as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`${res.status} ${err}`);
  }
  return data;
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
