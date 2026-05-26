import { Command } from "commander";
import { printJson, request } from "../lib/request.js";

interface CreateOpts {
  variant: string;
  marker: string;
  cutter: string;
  cutTicket: string;
  notes?: string;
}

interface ListOpts {
  status?: string;
  variant?: string;
  activeOnly?: boolean;
}

interface ValidateOpts {
  notes?: string;
}

interface ReasonOpts {
  reason: string;
}

interface StatusOpts {
  marker: string;
}

export function registerPvtCommand(program: Command): void {
  const pvt = new Command("pvt").description("Production Validation Testing commands");

  pvt
    .command("create")
    .description("Create a new PVT run (POST /api/pvt)")
    .requiredOption("--variant <id>", "product variant id")
    .requiredOption("--marker <id>", "marker id")
    .requiredOption("--cutter <userId>", "cutter user id")
    .requiredOption("--cut-ticket <id>", "cut ticket id (must have kind='pvt')")
    .option("--notes <notes>", "notes")
    .action(async (opts: CreateOpts) => {
      const data = await request("POST", "/api/pvt", {
        productVariantId: Number(opts.variant),
        markerId: Number(opts.marker),
        cutterUserId: Number(opts.cutter),
        cutTicketId: Number(opts.cutTicket),
        notes: opts.notes ?? null,
      });
      printJson(data);
    });

  pvt
    .command("list")
    .description("List PVT runs (GET /api/pvt)")
    .option("--status <status>", "cutting | shipped | inspecting | validated | rejected | cancelled")
    .option("--variant <id>", "filter by variant id")
    .option("--active-only", "only authorized/in-progress runs", false)
    .action(async (opts: ListOpts) => {
      const params = new URLSearchParams();
      if (opts.status) params.set("status", opts.status);
      if (opts.variant) params.set("variantId", opts.variant);
      if (opts.activeOnly) params.set("activeOnly", "true");
      const qs = params.toString();
      const data = await request("GET", `/api/pvt${qs ? `?${qs}` : ""}`);
      printJson(data);
    });

  pvt
    .command("show <ref>")
    .description("Show a PVT run by id or PVT-YYYY-####")
    .action(async (ref: string) => {
      const data = await request("GET", `/api/pvt/${encodeURIComponent(ref)}`);
      printJson(data);
    });

  pvt
    .command("ship <ref>")
    .description("cutting → shipped")
    .action(async (ref: string) => {
      const data = await request("POST", `/api/pvt/${encodeURIComponent(ref)}/ship`);
      printJson(data);
    });

  pvt
    .command("receive <ref>")
    .description("shipped → inspecting")
    .action(async (ref: string) => {
      const data = await request("POST", `/api/pvt/${encodeURIComponent(ref)}/receive`);
      printJson(data);
    });

  pvt
    .command("validate <ref>")
    .description("inspecting → validated (opens the production gate)")
    .option("--notes <notes>", "validator notes")
    .action(async (ref: string, opts: ValidateOpts) => {
      const data = await request("POST", `/api/pvt/${encodeURIComponent(ref)}/validate`, {
        notes: opts.notes ?? null,
      });
      printJson(data);
    });

  pvt
    .command("reject <ref>")
    .description("inspecting → rejected (closes the gate; must cut a new PVT)")
    .requiredOption("--reason <reason>", "reject reason (required)")
    .action(async (ref: string, opts: ReasonOpts) => {
      const data = await request("POST", `/api/pvt/${encodeURIComponent(ref)}/reject`, {
        reason: opts.reason,
      });
      printJson(data);
    });

  pvt
    .command("cancel <ref>")
    .description("Cancel a non-terminal PVT run")
    .requiredOption("--reason <reason>", "cancel reason (required)")
    .action(async (ref: string, opts: ReasonOpts) => {
      const data = await request("POST", `/api/pvt/${encodeURIComponent(ref)}/cancel`, {
        reason: opts.reason,
      });
      printJson(data);
    });

  pvt
    .command("status <variantId>")
    .description("Check (variant, marker) authorization for production")
    .requiredOption("--marker <id>", "marker id to check")
    .action(async (variantId: string, opts: StatusOpts) => {
      const params = new URLSearchParams({ markerId: opts.marker });
      const data = await request(
        "GET",
        `/api/products/${encodeURIComponent(variantId)}/pvt-status?${params.toString()}`,
      );
      printJson(data);
    });

  program.addCommand(pvt);
}
