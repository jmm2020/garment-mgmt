#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Command } from "commander";

const SESSION_DIR = join(homedir(), ".garment-mgmt");
const SESSION_FILE = join(SESSION_DIR, "session");
const DEFAULT_HOST = process.env.GM_HOST ?? "http://localhost:3000";

interface Session {
  host: string;
  cookie: string;
}

function loadSession(): Session | null {
  try {
    const raw = readFileSync(SESSION_FILE, "utf8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function saveSession(s: Session): void {
  mkdirSync(dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(s), { mode: 0o600 });
}

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const session = loadSession();
  const host = session?.host ?? DEFAULT_HOST;
  const headers: Record<string, string> = { "content-type": "application/json" };
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

const program = new Command();
program.name("gm").description("Garment management CLI").version("0.1.0");

program
  .command("login <email>")
  .description("Log in and persist session")
  .option("-p, --password <password>", "Password")
  .option("--host <host>", "API host", DEFAULT_HOST)
  .action(async (email: string, opts: { password?: string; host: string }) => {
    const password = opts.password ?? process.env.GM_PASSWORD;
    if (!password) {
      console.error("Use --password or GM_PASSWORD env");
      process.exit(2);
    }
    const res = await fetch(`${opts.host}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      console.error(`login failed: ${res.status}`);
      process.exit(1);
    }
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) {
      console.error("no session cookie returned");
      process.exit(1);
    }
    const cookie = setCookie.split(";")[0] ?? "";
    saveSession({ host: opts.host, cookie });
    console.log("logged in");
  });

program
  .command("vendors")
  .description("Vendor commands")
  .addCommand(
    new Command("list").action(async () => {
      const data = await request("GET", "/api/vendors");
      console.log(JSON.stringify(data, null, 2));
    }),
  );

program
  .command("materials")
  .description("Material commands")
  .addCommand(
    new Command("list").action(async () => {
      const data = await request("GET", "/api/materials");
      console.log(JSON.stringify(data, null, 2));
    }),
  );

const po = new Command("po").description("Purchase order commands");
po.command("list").action(async () => {
  const data = await request("GET", "/api/pos");
  console.log(JSON.stringify(data, null, 2));
});
po.command("show <id>").action(async (id: string) => {
  const data = await request("GET", `/api/pos/${id}`);
  console.log(JSON.stringify(data, null, 2));
});
po.command("receive <lineId>")
  .description("Receive lots against a PO line; reads JSON {lots:[...]} from stdin")
  .action(async (lineId: string) => {
    const body = await readStdin();
    const data = await request("POST", `/api/pos/lines/${lineId}/receive`, JSON.parse(body));
    console.log(JSON.stringify(data, null, 2));
  });
program.addCommand(po);

const bom = new Command("bom").description("BOM commands");
bom.command("show <id>").action(async (id: string) => {
  const data = await request("GET", `/api/boms/${id}`);
  console.log(JSON.stringify(data, null, 2));
});
program.addCommand(bom);

const ct = new Command("ct").description("Cut ticket commands");
ct.command("list").action(async () => {
  const data = await request("GET", "/api/cut-tickets");
  console.log(JSON.stringify(data, null, 2));
});
ct.command("create")
  .description("Create cut ticket; reads JSON body from stdin")
  .action(async () => {
    const body = await readStdin();
    const data = await request("POST", "/api/cut-tickets", JSON.parse(body));
    console.log(JSON.stringify(data, null, 2));
  });
ct.command("show <id>").action(async (id: string) => {
  const data = await request("GET", `/api/cut-tickets/${id}`);
  console.log(JSON.stringify(data, null, 2));
});
ct.command("close <id>")
  .description("Close cut ticket; reads JSON {actuals:[...]} from stdin")
  .action(async (id: string) => {
    const body = await readStdin();
    const data = await request("POST", `/api/cut-tickets/${id}/close`, JSON.parse(body));
    console.log(JSON.stringify(data, null, 2));
  });
program.addCommand(ct);

const lot = new Command("lot").description("Lot commands");
lot.command("provenance <id>").action(async (id: string) => {
  const data = await request("GET", `/api/lots/${id}/provenance`);
  console.log(JSON.stringify(data, null, 2));
});
program.addCommand(lot);

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
