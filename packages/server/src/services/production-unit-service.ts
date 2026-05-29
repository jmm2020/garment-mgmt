import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { BusinessRuleError, NotFoundError, ValidationFailedError } from "../errors.js";
import { recordAudit } from "./audit-service.js";

type ProductionUnit = schema.ProductionUnit;
type ProductionUnitStatus = schema.ProductionUnitStatus;
type QcVerdict = schema.QcVerdict;

const QC_VERDICTS = new Set<QcVerdict>(["pass", "fail", "pass_with_notes"]);

export interface RecordUnitQcVerdictInput {
  unitSerial: string;
  batchId: number;
  verdict: QcVerdict;
  reason?: string | null;
  actorUserId?: number;
}

export interface UnitWithProvenance {
  unit: ProductionUnit;
  batch: {
    id: number;
    batchNo: string;
    status: schema.ProductionBatchStatus;
    cutTicketId: number;
    productVariantId: number;
    qtyPlanned: string;
    qtyActual: string | null;
    qcVerdict: QcVerdict | null;
  };
  cutTicket: {
    id: number;
    ticketNumber: string;
  };
}

export async function mintUnits(
  db: DbExecutor,
  batchId: number,
  qty: number,
  actorUserId?: number,
): Promise<ProductionUnit[]> {
  if (!Number.isInteger(qty) || qty < 0) {
    throw new ValidationFailedError("qty must be a non-negative integer");
  }
  if (qty === 0) return [];

  const year = new Date().getUTCFullYear();
  const prefix = `U-${year}-`;
  const rows = await db.execute<{ max_serial: string | null }>(sql`
    SELECT MAX(unit_serial) AS max_serial
    FROM production_units
    WHERE unit_serial LIKE ${prefix + "%"}
  `);
  const maxSerial = rows[0]?.max_serial ?? null;
  const lastSeq = maxSerial ? Number.parseInt(maxSerial.slice(prefix.length), 10) : 0;
  const startSeq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;

  const values: schema.NewProductionUnit[] = [];
  for (let i = 0; i < qty; i += 1) {
    values.push({
      unitSerial: `${prefix}${String(startSeq + i).padStart(6, "0")}`,
      batchId,
    });
  }

  const inserted = await db.insert(schema.productionUnits).values(values).returning();
  if (inserted.length !== qty) {
    throw new ValidationFailedError(`mintUnits: expected ${qty} rows, got ${inserted.length}`);
  }

  const firstSerial = inserted[0]?.unitSerial ?? null;
  const lastSerial = inserted[inserted.length - 1]?.unitSerial ?? null;

  await db.insert(schema.productionEvents).values({
    batchId,
    eventType: "units_minted",
    fromStatus: null,
    toStatus: null,
    actorUserId,
    payload: { count: qty, firstSerial, lastSerial },
  });

  await recordAudit({
    db,
    entityType: "production_batch",
    entityId: batchId,
    action: "units_minted",
    actorUserId,
    after: { count: qty, firstSerial, lastSerial },
  });

  return inserted;
}

export async function recordUnitQcVerdict(
  db: Database,
  input: RecordUnitQcVerdictInput,
): Promise<ProductionUnit> {
  if (!QC_VERDICTS.has(input.verdict)) {
    throw new ValidationFailedError(`verdict must be one of: ${[...QC_VERDICTS].join(", ")}`);
  }
  return db.transaction(async (tx) => {
    const [unit] = await tx
      .select()
      .from(schema.productionUnits)
      .where(eq(schema.productionUnits.unitSerial, input.unitSerial));
    if (!unit) throw new NotFoundError("production_unit", input.unitSerial);
    if (unit.batchId !== input.batchId) {
      throw new NotFoundError("production_unit", input.unitSerial);
    }
    if (unit.status !== "created") {
      throw new BusinessRuleError(
        "unit_verdict_already_set",
        `Unit ${input.unitSerial} already has a verdict (status=${unit.status})`,
      );
    }
    const newStatus: ProductionUnitStatus = input.verdict === "fail" ? "qc_rejected" : "qc_passed";

    const [after] = await tx
      .update(schema.productionUnits)
      .set({
        status: newStatus,
        qcVerdict: input.verdict,
        qcRejectedReason: input.reason ?? null,
        qcActorUserId: input.actorUserId,
        qcAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.productionUnits.id, unit.id))
      .returning();
    if (!after) throw new ValidationFailedError("production_unit update returned no row");

    await tx.insert(schema.productionEvents).values({
      batchId: unit.batchId,
      eventType: "unit_qc_verdict",
      fromStatus: null,
      toStatus: null,
      actorUserId: input.actorUserId,
      payload: {
        unitSerial: input.unitSerial,
        verdict: input.verdict,
        reason: input.reason ?? null,
      },
    });

    await recordAudit({
      db: tx,
      entityType: "production_unit",
      entityId: unit.id,
      action: "qc_verdict_set",
      actorUserId: input.actorUserId,
      before: unit,
      after,
    });

    return after;
  });
}

export async function getUnit(db: DbExecutor, unitSerial: string): Promise<UnitWithProvenance> {
  const [row] = await db
    .select({
      unit: schema.productionUnits,
      batch: schema.productionBatches,
      cutTicket: schema.cutTickets,
    })
    .from(schema.productionUnits)
    .innerJoin(
      schema.productionBatches,
      eq(schema.productionUnits.batchId, schema.productionBatches.id),
    )
    .innerJoin(schema.cutTickets, eq(schema.productionBatches.cutTicketId, schema.cutTickets.id))
    .where(eq(schema.productionUnits.unitSerial, unitSerial));
  if (!row) throw new NotFoundError("production_unit", unitSerial);

  return {
    unit: row.unit,
    batch: {
      id: row.batch.id,
      batchNo: row.batch.batchNo,
      status: row.batch.status,
      cutTicketId: row.batch.cutTicketId,
      productVariantId: row.batch.productVariantId,
      qtyPlanned: row.batch.qtyPlanned,
      qtyActual: row.batch.qtyActual,
      qcVerdict: row.batch.qcVerdict,
    },
    cutTicket: {
      id: row.cutTicket.id,
      ticketNumber: row.cutTicket.ticketNumber,
    },
  };
}

export async function listBatchUnits(
  db: DbExecutor,
  batchId: number,
  filter: { verdict?: QcVerdict } = {},
): Promise<ProductionUnit[]> {
  const conditions = [eq(schema.productionUnits.batchId, batchId)];
  if (filter.verdict) {
    conditions.push(eq(schema.productionUnits.qcVerdict, filter.verdict));
  }
  return db
    .select()
    .from(schema.productionUnits)
    .where(and(...conditions))
    .orderBy(asc(schema.productionUnits.id));
}
