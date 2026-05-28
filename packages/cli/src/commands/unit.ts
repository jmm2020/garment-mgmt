import { Command } from "commander";
import { printJson, request } from "../lib/request.js";

interface QcOpts {
  verdict: "pass" | "fail" | "pass_with_notes";
  reason?: string;
}

interface ListOpts {
  verdict?: "pass" | "fail" | "pass_with_notes";
}

export function registerUnitCommand(program: Command): void {
  const unit = new Command("unit").description("Production unit commands");

  unit
    .command("show <serial>")
    .description("Show unit provenance by serial (GET /api/units/:serial)")
    .action(async (serial: string) => {
      const data = await request("GET", `/api/units/${encodeURIComponent(serial)}`);
      printJson(data);
    });

  unit
    .command("list <batchId>")
    .description("List units for a batch (GET /api/batches/:batchId/units)")
    .option("--verdict <verdict>", "filter by qc verdict: pass | fail | pass_with_notes")
    .action(async (batchId: string, opts: ListOpts) => {
      const params = new URLSearchParams();
      if (opts.verdict) params.set("verdict", opts.verdict);
      const qs = params.toString();
      const data = await request(
        "GET",
        `/api/batches/${encodeURIComponent(batchId)}/units${qs ? `?${qs}` : ""}`,
      );
      printJson(data);
    });

  unit
    .command("qc <batchId> <serial>")
    .description("Record per-unit QC verdict (POST /api/batches/:batchId/units/:serial/qc)")
    .requiredOption("--verdict <verdict>", "pass | fail | pass_with_notes")
    .option("--reason <reason>", "reject reason (recommended when verdict=fail)")
    .action(async (batchId: string, serial: string, opts: QcOpts) => {
      const data = await request(
        "POST",
        `/api/batches/${encodeURIComponent(batchId)}/units/${encodeURIComponent(serial)}/qc`,
        { verdict: opts.verdict, reason: opts.reason ?? null },
      );
      printJson(data);
    });

  program.addCommand(unit);
}
