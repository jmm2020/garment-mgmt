import { Command } from "commander";
import { printJson, request } from "../lib/request.js";

interface LoadOpts {
  date: string;
}

export function registerLineCommand(program: Command): void {
  const line = new Command("line").description("Sew line commands");

  line
    .command("list")
    .description("List all sew lines with their machines (GET /api/sew-lines)")
    .action(async () => {
      printJson(await request("GET", "/api/sew-lines"));
    });

  line
    .command("show <id>")
    .description("Show a sew line by numeric id (GET /api/sew-lines/:id)")
    .action(async (id: string) => {
      printJson(await request("GET", `/api/sew-lines/${encodeURIComponent(id)}`));
    });

  line
    .command("load <id>")
    .description("Get current load for a sew line on a given date")
    .requiredOption("--date <YYYY-MM-DD>", "date to query load for")
    .action(async (id: string, opts: LoadOpts) => {
      const qs = new URLSearchParams({ date: opts.date });
      printJson(await request("GET", `/api/sew-lines/${encodeURIComponent(id)}/load?${qs}`));
    });

  program.addCommand(line);
}
