import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { BusinessRuleError, NotFoundError } from "../errors.js";
import { recordAudit } from "./audit-service.js";
import { loadBatch, writeEvent, type BatchRef } from "./production-batch-queries.js";

type SewLine = schema.SewLine;
type Machine = schema.Machine;
type ProductionBatch = schema.ProductionBatch;

// Terminal batch states cannot be (re)assigned to or released from a line — they are a
// frozen forensic record (ADR-0005, CLAUDE.md rule 8).
const TERMINAL_STATUSES = new Set<schema.ProductionBatchStatus>(["completed", "cancelled"]);

export interface SewLineWithMachines extends SewLine {
  machines: Machine[];
}

export interface CreateSewLineInput {
  code: string;
  name: string;
  capacityUnitsPerDay: number;
  active?: boolean;
  actorUserId?: number;
}

export async function createSewLine(db: Database, input: CreateSewLineInput): Promise<SewLine> {
  return db.transaction(async (tx) => {
    const [line] = await tx
      .insert(schema.sewLines)
      .values({
        code: input.code,
        name: input.name,
        capacityUnitsPerDay: input.capacityUnitsPerDay,
        active: input.active ?? true,
      })
      .returning();
    if (!line) throw new Error("sew_line insert returned no row");
    await recordAudit({
      db: tx,
      entityType: "sew_line",
      entityId: line.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: line,
    });
    return line;
  });
}

export interface AddMachineInput {
  sewLineId: number;
  code: string;
  type: schema.MachineType;
  status?: schema.MachineStatus;
  actorUserId?: number;
}

export async function addMachine(db: Database, input: AddMachineInput): Promise<Machine> {
  return db.transaction(async (tx) => {
    await loadSewLine(tx, input.sewLineId);
    const [machine] = await tx
      .insert(schema.machines)
      .values({
        sewLineId: input.sewLineId,
        code: input.code,
        type: input.type,
        status: input.status ?? "available",
      })
      .returning();
    if (!machine) throw new Error("machine insert returned no row");
    await recordAudit({
      db: tx,
      entityType: "machine",
      entityId: machine.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: machine,
    });
    return machine;
  });
}

export async function updateMachineStatus(
  db: Database,
  machineId: number,
  status: schema.MachineStatus,
  actorUserId?: number,
): Promise<Machine> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.machines)
      .where(eq(schema.machines.id, machineId));
    if (!before) throw new NotFoundError("machine", machineId);

    const [after] = await tx
      .update(schema.machines)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.machines.id, machineId))
      .returning();
    if (!after) throw new NotFoundError("machine", machineId);

    await recordAudit({
      db: tx,
      entityType: "machine",
      entityId: machineId,
      action: `state_transition:${before.status}->${status}`,
      actorUserId,
      before,
      after,
    });
    return after;
  });
}

export async function listSewLines(db: Database): Promise<SewLineWithMachines[]> {
  const lines = await db.select().from(schema.sewLines).orderBy(asc(schema.sewLines.code));
  if (lines.length === 0) return [];
  const lineIds = lines.map((l) => l.id);
  const machineRows = await db
    .select()
    .from(schema.machines)
    .where(inArray(schema.machines.sewLineId, lineIds))
    .orderBy(asc(schema.machines.code));
  const byLine = new Map<number, Machine[]>();
  for (const m of machineRows) {
    const arr = byLine.get(m.sewLineId) ?? [];
    arr.push(m);
    byLine.set(m.sewLineId, arr);
  }
  return lines.map((line) => ({ ...line, machines: byLine.get(line.id) ?? [] }));
}

export async function getSewLine(db: Database, id: number): Promise<SewLineWithMachines> {
  const line = await loadSewLine(db, id);
  const machineRows = await db
    .select()
    .from(schema.machines)
    .where(eq(schema.machines.sewLineId, id))
    .orderBy(asc(schema.machines.code));
  return { ...line, machines: machineRows };
}

export interface LineLoad {
  sewLineId: number;
  date: string;
  totalQtyPlanned: string;
  batchCount: number;
}

export async function getLineLoad(
  db: Database,
  sewLineId: number,
  date: string,
): Promise<LineLoad> {
  await loadSewLine(db, sewLineId);
  // SQL-side aggregation (CLAUDE.md rule 4) — never sum numerics in JS. Load is keyed off the
  // batch receive date in the server's local timezone (documented in ADR-0008).
  const rows = await db.execute<{ total: string; cnt: string }>(sql`
    SELECT
      COALESCE(SUM(qty_planned), '0')::text AS total,
      COUNT(*)::text                        AS cnt
    FROM production_batches
    WHERE sew_line_id = ${sewLineId}
      AND status = 'in_production'
      AND received_at::date = ${date}::date
  `);
  const row = rows[0];
  return {
    sewLineId,
    date,
    totalQtyPlanned: row?.total ?? "0",
    batchCount: Number(row?.cnt ?? 0),
  };
}

export interface AssignBatchToLineInput {
  ref: BatchRef;
  sewLineId: number;
  actorUserId?: number;
}

export async function assignBatchToLine(
  db: Database,
  input: AssignBatchToLineInput,
): Promise<ProductionBatch> {
  return db.transaction(async (tx) => {
    const before = await loadBatch(tx, input.ref);
    if (TERMINAL_STATUSES.has(before.status)) {
      throw new BusinessRuleError(
        "batch_terminal",
        `Cannot assign a line to batch in status=${before.status}`,
      );
    }
    const line = await loadSewLine(tx, input.sewLineId);

    const [after] = await tx
      .update(schema.productionBatches)
      .set({ sewLineId: line.id, assignedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.productionBatches.id, before.id))
      .returning();
    if (!after) throw new Error("production_batch update returned no row");

    await writeEvent(tx, {
      batchId: after.id,
      eventType: "line_assignment",
      actorUserId: input.actorUserId,
      payload: { sewLineId: line.id, lineCode: line.code },
    });
    await recordAudit({
      db: tx,
      entityType: "production_batch",
      entityId: after.id,
      action: "line_assignment",
      actorUserId: input.actorUserId,
      before: { sewLineId: before.sewLineId },
      after: { sewLineId: line.id },
    });
    return after;
  });
}

export async function releaseBatchFromLine(
  db: Database,
  ref: BatchRef,
  actorUserId?: number,
): Promise<ProductionBatch> {
  return db.transaction(async (tx) => {
    const before = await loadBatch(tx, ref);
    if (TERMINAL_STATUSES.has(before.status)) {
      throw new BusinessRuleError(
        "batch_terminal",
        `Cannot release a line from batch in status=${before.status}`,
      );
    }

    const [after] = await tx
      .update(schema.productionBatches)
      .set({ sewLineId: null, assignedAt: null, updatedAt: new Date() })
      .where(eq(schema.productionBatches.id, before.id))
      .returning();
    if (!after) throw new Error("production_batch update returned no row");

    await writeEvent(tx, {
      batchId: after.id,
      eventType: "line_release",
      actorUserId,
      payload: { sewLineId: before.sewLineId },
    });
    await recordAudit({
      db: tx,
      entityType: "production_batch",
      entityId: after.id,
      action: "line_release",
      actorUserId,
      before: { sewLineId: before.sewLineId },
      after: { sewLineId: null },
    });
    return after;
  });
}

// DbExecutor (not Database) so it composes inside assignBatchToLine's transaction (CLAUDE.md rule 3).
async function loadSewLine(db: DbExecutor, id: number): Promise<SewLine> {
  const [line] = await db.select().from(schema.sewLines).where(eq(schema.sewLines.id, id));
  if (!line) throw new NotFoundError("sew_line", id);
  return line;
}
