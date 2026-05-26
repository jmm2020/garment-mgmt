import { Command } from "commander";
import { printJson, request } from "../lib/request.js";

interface ReceiveOpts {
  cutTicket: string;
  variant: string;
  qty: string;
  cutter: string;
  notes?: string;
  force?: boolean;
}

interface ListOpts {
  status?: string;
  sku?: string;
  since?: string;
  cutter?: string;
}

interface SubmitQcOpts {
  qty: string;
}

interface CompleteOpts {
  qty: string;
  verdict: "pass" | "fail" | "pass_with_notes";
  note?: string;
}

interface CancelOpts {
  reason: string;
}

export function registerBatchCommand(program: Command): void {
  const batch = new Command("batch").description("Production batch commands");

  batch
    .command("receive")
    .description("Receive a batch from the cutter (POST /api/batches)")
    .requiredOption("--cut-ticket <id>", "cut ticket id")
    .requiredOption("--variant <id>", "product variant id")
    .requiredOption("--qty <qty>", "qty planned (numeric string)")
    .requiredOption("--cutter <userId>", "cutter user id")
    .option("--notes <notes>", "notes")
    .option("--force", "bypass the PVT gate; records an override audit row", false)
    .action(async (opts: ReceiveOpts) => {
      const data = await request("POST", "/api/batches", {
        cutTicketId: Number(opts.cutTicket),
        productVariantId: Number(opts.variant),
        qtyPlanned: opts.qty,
        cutterUserId: Number(opts.cutter),
        notes: opts.notes ?? null,
        force: opts.force ?? false,
      });
      printJson(data);
    });

  batch
    .command("list")
    .description("List batches (GET /api/batches)")
    .option("--status <status>", "filter by status")
    .option("--sku <sku>", "filter by canonical sku")
    .option("--since <iso>", "only batches received on/after this ISO timestamp")
    .option("--cutter <userId>", "filter by cutter user id")
    .action(async (opts: ListOpts) => {
      const params = new URLSearchParams();
      if (opts.status) params.set("status", opts.status);
      if (opts.sku) params.set("sku", opts.sku);
      if (opts.since) params.set("since", opts.since);
      if (opts.cutter) params.set("cutterUserId", opts.cutter);
      const qs = params.toString();
      const data = await request("GET", `/api/batches${qs ? `?${qs}` : ""}`);
      printJson(data);
    });

  batch
    .command("show <ref>")
    .description("Show a batch by id or PB-YYYY-#### (GET /api/batches/:ref)")
    .action(async (ref: string) => {
      const data = await request("GET", `/api/batches/${encodeURIComponent(ref)}`);
      printJson(data);
    });

  // `find` is an explicit alias for forensic lookup by PB-YYYY-####.
  batch
    .command("find <batchNo>")
    .description("Forensic lookup by PB-YYYY-#### batch number (alias for show)")
    .action(async (batchNo: string) => {
      const data = await request("GET", `/api/batches/${encodeURIComponent(batchNo)}`);
      printJson(data);
    });

  batch
    .command("stage <ref>")
    .description("received_from_cutter → staged_pre_prod")
    .action(async (ref: string) => {
      const data = await request("POST", `/api/batches/${encodeURIComponent(ref)}/stage`);
      printJson(data);
    });

  batch
    .command("start <ref>")
    .description("staged_pre_prod → in_production")
    .action(async (ref: string) => {
      const data = await request("POST", `/api/batches/${encodeURIComponent(ref)}/start`);
      printJson(data);
    });

  batch
    .command("submit-qc <ref>")
    .description("in_production → awaiting_qc")
    .requiredOption("--qty <qty>", "produced qty (numeric string)")
    .action(async (ref: string, opts: SubmitQcOpts) => {
      const data = await request("POST", `/api/batches/${encodeURIComponent(ref)}/submit-qc`, {
        qty: opts.qty,
      });
      printJson(data);
    });

  batch
    .command("complete <ref>")
    .description("awaiting_qc → completed (records qc verdict)")
    .requiredOption("--qty <qty>", "final accepted qty")
    .requiredOption("--verdict <verdict>", "pass | fail | pass_with_notes")
    .option("--note <note>", "qc note")
    .action(async (ref: string, opts: CompleteOpts) => {
      const data = await request("POST", `/api/batches/${encodeURIComponent(ref)}/complete`, {
        qty: opts.qty,
        verdict: opts.verdict,
        note: opts.note ?? null,
      });
      printJson(data);
    });

  batch
    .command("cancel <ref>")
    .description("Cancel a non-terminal batch")
    .requiredOption("--reason <reason>", "cancel reason (required)")
    .action(async (ref: string, opts: CancelOpts) => {
      const data = await request("POST", `/api/batches/${encodeURIComponent(ref)}/cancel`, {
        reason: opts.reason,
      });
      printJson(data);
    });

  program.addCommand(batch);
}
