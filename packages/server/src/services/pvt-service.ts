import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { eq, sql } from "drizzle-orm";
import { BusinessRuleError, NotFoundError, ValidationFailedError } from "../errors.js";
import { recordAudit } from "./audit-service.js";
import { getPvtAuthorization, loadRun, type RunRef } from "./pvt-queries.js";

type Run = schema.ProductionValidationRun;
type PvtStatus = schema.PvtStatus;

const DEFAULT_VALIDITY_MONTHS = Number(process.env.PVT_DEFAULT_VALIDITY_MONTHS ?? 6);

export interface CreatePvtRunInput {
  productVariantId: number;
  markerId: number;
  cutterUserId: number;
  cutTicketId: number;
  notes?: string | null;
  actorUserId?: number;
}

export async function createPvtRun(db: Database, input: CreatePvtRunInput): Promise<Run> {
  return db.transaction(async (tx) => {
    const [ct] = await tx
      .select()
      .from(schema.cutTickets)
      .where(eq(schema.cutTickets.id, input.cutTicketId));
    if (!ct) throw new NotFoundError("cut_ticket", input.cutTicketId);
    if (ct.kind !== "pvt") {
      throw new BusinessRuleError(
        "cut_ticket_not_pvt",
        `cut_ticket ${ct.ticketNumber} has kind=${ct.kind}; PVT run requires kind='pvt'`,
      );
    }

    const runNo = await nextRunNo(tx);
    const [run] = await tx
      .insert(schema.productionValidationRuns)
      .values({
        runNo,
        productVariantId: input.productVariantId,
        markerId: input.markerId,
        cutTicketId: input.cutTicketId,
        status: "cutting",
        cutterUserId: input.cutterUserId,
        notes: input.notes ?? null,
      })
      .returning();
    if (!run) throw new Error("pvt insert returned no row");

    await recordAudit({
      db: tx,
      entityType: "production_validation_run",
      entityId: run.id,
      action: "state_transition:null->cutting",
      actorUserId: input.actorUserId,
      after: run,
    });
    return run;
  });
}

export async function markPvtShipped(
  db: Database,
  ref: RunRef,
  actorUserId?: number,
): Promise<Run> {
  return simpleTransition(db, ref, {
    from: "cutting",
    to: "shipped",
    timestampColumn: "shippedAt",
    actorUserId,
  });
}

export async function markPvtReceived(
  db: Database,
  ref: RunRef,
  actorUserId?: number,
): Promise<Run> {
  return simpleTransition(db, ref, {
    from: "shipped",
    to: "inspecting",
    timestampColumn: "receivedAt",
    actorUserId,
  });
}

export interface ValidatePvtInput {
  ref: RunRef;
  validatorUserId: number;
  notes?: string | null;
}

export async function validatePvt(db: Database, input: ValidatePvtInput): Promise<Run> {
  return db.transaction(async (tx) => {
    const before = await loadRun(tx, input.ref);
    if (before.status !== "inspecting") {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot validate from status=${before.status}`,
      );
    }
    const validityMonths = await resolveValidityMonths(tx, before.productVariantId);
    const validatedAt = new Date();
    const expiresAt = addMonths(validatedAt, validityMonths);

    const [after] = await tx
      .update(schema.productionValidationRuns)
      .set({
        status: "validated",
        validatorUserId: input.validatorUserId,
        validatedAt,
        expiresAt,
        validityMonths,
        notes: input.notes ?? before.notes,
        updatedAt: new Date(),
      })
      .where(eq(schema.productionValidationRuns.id, before.id))
      .returning();
    if (!after) throw new Error("pvt update returned no row");

    await recordAudit({
      db: tx,
      entityType: "production_validation_run",
      entityId: after.id,
      action: "state_transition:inspecting->validated",
      actorUserId: input.validatorUserId,
      before,
      after,
    });
    return after;
  });
}

export interface RejectPvtInput {
  ref: RunRef;
  validatorUserId: number;
  reason: string;
}

export async function rejectPvt(db: Database, input: RejectPvtInput): Promise<Run> {
  if (!input.reason?.trim()) {
    throw new ValidationFailedError("reject reason is required");
  }
  return db.transaction(async (tx) => {
    const before = await loadRun(tx, input.ref);
    if (before.status !== "inspecting") {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot reject from status=${before.status}`,
      );
    }
    const [after] = await tx
      .update(schema.productionValidationRuns)
      .set({
        status: "rejected",
        validatorUserId: input.validatorUserId,
        rejectedAt: new Date(),
        rejectedReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.productionValidationRuns.id, before.id))
      .returning();
    if (!after) throw new Error("pvt update returned no row");

    await recordAudit({
      db: tx,
      entityType: "production_validation_run",
      entityId: after.id,
      action: "state_transition:inspecting->rejected",
      actorUserId: input.validatorUserId,
      before,
      after,
    });
    return after;
  });
}

export interface CancelPvtInput {
  ref: RunRef;
  actorUserId: number;
  reason: string;
}

export async function cancelPvtRun(db: Database, input: CancelPvtInput): Promise<Run> {
  if (!input.reason?.trim()) {
    throw new ValidationFailedError("cancel reason is required");
  }
  return db.transaction(async (tx) => {
    const before = await loadRun(tx, input.ref);
    if (
      before.status === "validated" ||
      before.status === "rejected" ||
      before.status === "cancelled"
    ) {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot cancel PVT in terminal status=${before.status}`,
      );
    }
    const [after] = await tx
      .update(schema.productionValidationRuns)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.productionValidationRuns.id, before.id))
      .returning();
    if (!after) throw new Error("pvt update returned no row");

    await recordAudit({
      db: tx,
      entityType: "production_validation_run",
      entityId: after.id,
      action: `state_transition:${before.status}->cancelled`,
      actorUserId: input.actorUserId,
      before,
      after,
    });
    return after;
  });
}

/**
 * Throws BusinessRuleError("pvt_required", ...) if the (variantId, markerId) pair has no
 * current valid PVT. Used as the gate inside receiveFromCutter().
 */
export async function assertPvtCurrent(
  db: DbExecutor,
  productVariantId: number,
  markerId: number,
): Promise<void> {
  const auth = await getPvtAuthorization(db, productVariantId, markerId);
  if (auth.authorized) return;
  throw new BusinessRuleError(
    "pvt_required",
    `No current PVT for variant=${productVariantId} marker=${markerId} (${auth.reason})`,
    {
      reason: auth.reason,
      mostRecentRunNo: auth.mostRecentRun?.runNo ?? null,
      expiresAt: auth.expiresAt ?? null,
    },
  );
}

interface SimpleTransitionSpec {
  from: PvtStatus;
  to: PvtStatus;
  timestampColumn: "shippedAt" | "receivedAt";
  actorUserId?: number;
}

async function simpleTransition(
  db: Database,
  ref: RunRef,
  spec: SimpleTransitionSpec,
): Promise<Run> {
  return db.transaction(async (tx) => {
    const before = await loadRun(tx, ref);
    if (before.status !== spec.from) {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot transition PVT to ${spec.to} from ${before.status}`,
      );
    }
    const patch: Record<string, unknown> = {
      status: spec.to,
      updatedAt: new Date(),
    };
    patch[spec.timestampColumn] = new Date();

    const [after] = await tx
      .update(schema.productionValidationRuns)
      .set(patch)
      .where(eq(schema.productionValidationRuns.id, before.id))
      .returning();
    if (!after) throw new Error("pvt update returned no row");

    await recordAudit({
      db: tx,
      entityType: "production_validation_run",
      entityId: after.id,
      action: `state_transition:${spec.from}->${spec.to}`,
      actorUserId: spec.actorUserId,
      before,
      after,
    });
    return after;
  });
}

async function resolveValidityMonths(db: DbExecutor, variantId: number): Promise<number> {
  const rows = await db
    .select({ months: schema.products.pvtValidityMonths })
    .from(schema.products)
    .innerJoin(schema.productVariants, eq(schema.productVariants.productId, schema.products.id))
    .where(eq(schema.productVariants.id, variantId));
  const override = rows[0]?.months ?? null;
  return override ?? DEFAULT_VALIDITY_MONTHS;
}

function addMonths(d: Date, months: number): Date {
  const result = new Date(d);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

async function nextRunNo(db: DbExecutor): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `PVT-${year}-`;
  const rows = await db.execute<{ max_no: string | null }>(sql`
    SELECT MAX(run_no) AS max_no
    FROM production_validation_runs
    WHERE run_no LIKE ${prefix + "%"}
  `);
  const maxNo = rows[0]?.max_no ?? null;
  const lastSeq = maxNo ? Number.parseInt(maxNo.slice(prefix.length), 10) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}
