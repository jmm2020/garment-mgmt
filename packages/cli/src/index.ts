#!/usr/bin/env node
import { Command } from "commander";
import { registerBatchCommand } from "./commands/batch.js";
import { registerPvtCommand } from "./commands/pvt.js";
import {
  DEFAULT_HOST,
  printJson,
  readStdin,
  request,
  saveSession,
} from "./lib/request.js";

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
      printJson(await request("GET", "/api/vendors"));
    }),
  );

program
  .command("materials")
  .description("Material commands")
  .addCommand(
    new Command("list").action(async () => {
      printJson(await request("GET", "/api/materials"));
    }),
  );

const po = new Command("po").description("Purchase order commands");
po.command("list").action(async () => {
  printJson(await request("GET", "/api/pos"));
});
po.command("show <id>").action(async (id: string) => {
  printJson(await request("GET", `/api/pos/${id}`));
});
po.command("receive <lineId>")
  .description("Receive lots against a PO line; reads JSON {lots:[...]} from stdin")
  .action(async (lineId: string) => {
    const body = await readStdin();
    printJson(await request("POST", `/api/pos/lines/${lineId}/receive`, JSON.parse(body)));
  });
program.addCommand(po);

const bom = new Command("bom").description("BOM commands");
bom.command("show <id>").action(async (id: string) => {
  printJson(await request("GET", `/api/boms/${id}`));
});
program.addCommand(bom);

const ct = new Command("ct").description("Cut ticket commands");
ct.command("list").action(async () => {
  printJson(await request("GET", "/api/cut-tickets"));
});
ct.command("create")
  .description("Create cut ticket; reads JSON body from stdin")
  .action(async () => {
    const body = await readStdin();
    printJson(await request("POST", "/api/cut-tickets", JSON.parse(body)));
  });
ct.command("show <id>").action(async (id: string) => {
  printJson(await request("GET", `/api/cut-tickets/${id}`));
});
ct.command("close <id>")
  .description("Close cut ticket; reads JSON {actuals:[...]} from stdin")
  .action(async (id: string) => {
    const body = await readStdin();
    printJson(await request("POST", `/api/cut-tickets/${id}/close`, JSON.parse(body)));
  });
program.addCommand(ct);

const lot = new Command("lot").description("Lot commands");
lot.command("provenance <id>").action(async (id: string) => {
  printJson(await request("GET", `/api/lots/${id}/provenance`));
});
program.addCommand(lot);

registerBatchCommand(program);
registerPvtCommand(program);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
