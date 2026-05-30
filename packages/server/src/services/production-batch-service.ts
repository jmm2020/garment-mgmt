import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { eq, sql } from "drizzle-orm";
import { BusinessRuleError, InternalError, NotFoundError, ValidationFailedError } from "../errors.js";
import { recordAudit } from "./audit-service.js";
import { loadBatch, writeEvent, type BatchRef } from "./production-batch-queries.js";
import { mintUnits } from "./production-unit-service.js";
import { assertPvtCurrent } from "./pvt-service.js";

type ProductionBatch = schema.ProductionBatch;
type QcVerdict = schema.QcVerdict;

const QC_VERDICTS = new Set<QcVerdict>(["pass", "fail", "pass_with_notes"]);

export interface ReceiveFromCutterInput {
  cutTicketId: number;
  productVariantId: number;
  qtyPlanned: string;
  cutterUserId: number;
  notes?: string | null;
  actorUserId?: number;
  // Set true to bypass the PVT gate; an audit row records the override. Reserved for
  // emergencies — does NOT mark the variant as PVT-current.
  force?: boolean;
}

export async function receiveFromCutter(
  db: Database,
  input: ReceiveFromCutterInput,
): Promise<ProductionBatch> {
  return db.transaction(async (tx) => {
    const [ct] = await tx
      .select()
      .from(schema.cutTickets)
      .where(eq(schema.cutTickets.id, input.cutTicketId));
    if (!ct) throw new NotFoundError("cut_ticket", input.cutTicketId);
    if (ct.kind !== "production") {
      throw new BusinessRuleError(
        "cut_ticket_not_production",
        `cut_ticket ${ct.ticketNumber} has kind=${ct.kind}; only 'production' cuts can feed a batch`,
      );
    }
    if (!ct.markerId) {
      throw new BusinessRuleError(
        "cut_ticket_missing_marker",
        `cut_ticket ${ct.ticketNumber} has no marker; PVT gate requires a marker`,
      );
    }

    if (!input.force) {
      await assertPvtCurrent(tx, input.productVariantId, ct.markerId);
    }

    const planned = Number(input.qtyPlanned);
    if (!Number.isFinite(planned) || planned <= 0) {
      throw new ValidationFailedError("qtyPlanned must be > 0");
    }

    const batchNo = await nextBatchNo(tx);

    const [batch] = await tx
      .insert(schema.productionBatches)
      .values({
        batchNo,
        cutTicketId: input.cutTicketId,
        productVariantId: input.productVariantId,
        status: "received_from_cutter",
        qtyPlanned: planned.toFixed(3),
        cutterUserId: input.cutterUserId,
        notes: input.notes ?? null,
      })
      .returning();
    if (!batch)
      throw new InternalError("production_batch insert returned no row");

    await writeEvent(tx, {
      batchId: batch.id,
      eventType: "state_transition",
      fromStatus: null,
      toStatus: "received_from_cutter",
      actorUserId: input.actorUserId,
      payload: {
        qtyPlanned: planned,
        cutterUserId: input.cutterUserId,
        force: input.force ?? false,
      },
    });

    await recordAudit({
      db: tx,
      entityType: "production_batch",
      entityId: batch.id,
      action: "state_transition:null->received_from_cutter",
      actorUserId: input.actorUserId,
      after: batch,
    });

    if (input.force) {
      await recordAudit({
        db: tx,
        entityType: "production_batch",
        entityId: batch.id,
        action: "pvt_gate_override",
        actorUserId: input.actorUserId,
        after: { reason: "force flag set on receiveFromCutter" },
      });
    }

    return batch;
  });
}

export async function stageForProduction(
  db: Database,
  ref: BatchRef,
  actorUserId?: number,
): Promise<ProductionBatch> {
  return transition(db, ref, {
    from: "received_from_cutter",
    to: "staged_pre_prod",
    timestampColumn: "stagedAt",
    actorUserId,
  });
}

export async function startProduction(
  db: Database,
  ref: BatchRef,
  actorUserId?: number,
): Promise<ProductionBatch> {
  return db.transaction(async (tx) => {
    const before = await loadBatch(tx, ref);
    if (before.status !== "staged_pre_prod") {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot transition to in_production from ${before.status}`,
      );
    }
    const [after] = await tx
      .update(schema.productionBatches)
      .set({
        status: "in_production",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.productionBatches.id, before.id))
      .returning();
    if (!after)
      throw new InternalError("production_batch update returned no row");

    await writeEvent(tx, {
      batchId: after.id,
      eventType: "state_transition",
      fromStatus: "staged_pre_prod",
      toStatus: "in_production",
      actorUserId,
      payload: null,
    });
    await recordAudit({
      db: tx,
      entityType: "production_batch",
      entityId: after.id,
      action: "state_transition:staged_pre_prod->in_production",
      actorUserId,
      before,
      after,
    });

    await mintUnits(tx, after.id, Number(after.qtyPlanned), actorUserId);

    return after;
  });
}

export interface SubmitForQcInput {
  ref: BatchRef;
  qty: string;
  actorUserId?: number;
}

export async function submitForQc(db: Database, input: SubmitForQcInput): Promise<ProductionBatch> {
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ValidationFailedError("qty must be > 0");
  }
  return db.transaction(async (tx) => {
    const before = await loadBatch(tx, input.ref);
    if (before.status !== "in_production") {
      throw new BusinessRuleError("invalid_transition", `Cannot submitForQc from ${before.status}`);
    }
    if (qty > Number(before.qtyPlanned)) {
      throw new BusinessRuleError(
        "qty_exceeds_planned",
        `qty ${qty} exceeds qtyPlanned ${before.qtyPlanned}`,
      );
    }
    const [after] = await tx
      .update(schema.productionBatches)
      .set({
        status: "awaiting_qc",
        qtyActual: qty.toFixed(3),
        submittedQcAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.productionBatches.id, before.id))
      .returning();
    if (!after)
      throw new InternalError("production_batch update returned no row");

    await writeEvent(tx, {
      batchId: after.id,
      eventType: "state_transition",
      fromStatus: "in_production",
      toStatus: "awaiting_qc",
      actorUserId: input.actorUserId,
      payload: { qty },
    });
    await recordAudit({
      db: tx,
      entityType: "production_batch",
      entityId: after.id,
      action: "state_transition:in_production->awaiting_qc",
      actorUserId: input.actorUserId,
      before,
      after,
    });
    return after;
  });
}

export interface CompleteBatchInput {
  ref: BatchRef;
  qty: string;
  verdict: QcVerdict;
  note?: string | null;
  actorUserId?: number;
}

export async function completeBatch(
  db: Database,
  input: CompleteBatchInput,
): Promise<ProductionBatch> {
  if (!QC_VERDICTS.has(input.verdict)) {
    throw new ValidationFailedError(`verdict must be one of: ${[...QC_VERDICTS].join(", ")}`);
  }
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty < 0) {
    throw new ValidationFailedError("qty must be >= 0");
  }
  return db.transaction(async (tx) => {
    const before = await loadBatch(tx, input.ref);
    if (before.status !== "awaiting_qc") {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot completeBatch from ${before.status}`,
      );
    }
    const [after] = await tx
      .update(schema.productionBatches)
      .set({
        status: "completed",
        qtyActual: qty.toFixed(3),
        qcVerdict: input.verdict,
        qcUserId: input.actorUserId,
        completedAt: new Date(),
        updatedAt: new Date(),
        notes: input.note ?? before.notes,
      })
      .where(eq(schema.productionBatches.id, before.id))
      .returning();
    if (!after)
      throw new InternalError("production_batch update returned no row");

    await writeEvent(tx, {
      batchId: after.id,
      eventType: "qc_decision",
      fromStatus: "awaiting_qc",
      toStatus: "completed",
      actorUserId: input.actorUserId,
      payload: { qty, verdict: input.verdict, note: input.note },
    });
    await recordAudit({
      db: tx,
      entityType: "production_batch",
      entityId: after.id,
      action: "state_transition:awaiting_qc->completed",
      actorUserId: input.actorUserId,
      before,
      after,
    });
    return after;
  });
}

export interface CancelBatchInput {
  ref: BatchRef;
  reason: string;
  actorUserId?: number;
}

export async function cancelBatch(db: Database, input: CancelBatchInput): Promise<ProductionBatch> {
  if (!input.reason?.trim()) {
    throw new ValidationFailedError("cancel reason is required");
  }
  return db.transaction(async (tx) => {
    const before = await loadBatch(tx, input.ref);
    if (before.status === "completed" || before.status === "cancelled") {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot cancel batch in status=${before.status}`,
      );
    }
    const [after] = await tx
      .update(schema.productionBatches)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.productionBatches.id, before.id))
      .returning();
    if (!after)
      throw new InternalError("production_batch update returned no row");

    await writeEvent(tx, {
      batchId: after.id,
      eventType: "state_transition",
      fromStatus: before.status,
      toStatus: "cancelled",
      actorUserId: input.actorUserId,
      payload: { reason: input.reason },
    });
    await recordAudit({
      db: tx,
      entityType: "production_batch",
      entityId: after.id,
      action: `state_transition:${before.status}->cancelled`,
      actorUserId: input.actorUserId,
      before,
      after,
    });
    return after;
  });
}

interface SimpleTransitionInput {
  from: schema.ProductionBatchStatus;
  to: schema.ProductionBatchStatus;
  timestampColumn: "stagedAt" | "startedAt";
  actorUserId?: number;
}

async function transition(
  db: Database,
  ref: BatchRef,
  spec: SimpleTransitionInput,
): Promise<ProductionBatch> {
  return db.transaction(async (tx) => {
    const before = await loadBatch(tx, ref);
    if (before.status !== spec.from) {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot transition to ${spec.to} from ${before.status}`,
      );
    }
    const patch: Record<string, unknown> = {
      status: spec.to,
      updatedAt: new Date(),
    };
    patch[spec.timestampColumn] = new Date();

    const [after] = await tx
      .update(schema.productionBatches)
      .set(patch)
      .where(eq(schema.productionBatches.id, before.id))
      .returning();
    if (!after)
      throw new InternalError("production_batch update returned no row");

    await writeEvent(tx, {
      batchId: after.id,
      eventType: "state_transition",
      fromStatus: spec.from,
      toStatus: spec.to,
      actorUserId: spec.actorUserId,
      payload: null,
    });
    await recordAudit({
      db: tx,
      entityType: "production_batch",
      entityId: after.id,
      action: `state_transition:${spec.from}->${spec.to}`,
      actorUserId: spec.actorUserId,
      before,
      after,
    });
    return after;
  });
}

async function nextBatchNo(db: DbExecutor): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `PB-${year}-`;
  const rows = await db.execute<{ max_no: string | null }>(sql`
    SELECT MAX(batch_no) AS max_no
    FROM production_batches
    WHERE batch_no LIKE ${prefix + "%"}
  `);
  const maxNo = rows[0]?.max_no ?? null;
  const lastSeq = maxNo ? Number.parseInt(maxNo.slice(prefix.length), 10) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}
