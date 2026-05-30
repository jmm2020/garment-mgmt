import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { eq, inArray, sql } from "drizzle-orm";
import { BusinessRuleError, InternalError, NotFoundError } from "../errors.js";
import { recordAudit } from "./audit-service.js";

type Po = schema.PurchaseOrder;
type PoLine = schema.PurchaseOrderLine;

export interface CreatePoInput {
  poNumber: string;
  vendorId: number;
  currency?: string;
  expectedAt?: string | null;
  notes?: string | null;
  actorUserId?: number;
}

export async function createPo(db: Database, input: CreatePoInput): Promise<Po> {
  return db.transaction(async (tx) => {
    const [vendor] = await tx
      .select()
      .from(schema.vendors)
      .where(eq(schema.vendors.id, input.vendorId));
    if (!vendor) throw new NotFoundError("vendor", input.vendorId);

    const [po] = await tx
      .insert(schema.purchaseOrders)
      .values({
        poNumber: input.poNumber,
        vendorId: input.vendorId,
        currency: input.currency ?? "USD",
        expectedAt: input.expectedAt ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    if (!po)
      throw new InternalError("purchase_order insert returned no row");

    await recordAudit({
      db: tx,
      entityType: "purchase_order",
      entityId: po.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: po,
    });
    return po;
  });
}

export interface AddPoLineInput {
  poId: number;
  materialVariantId: number;
  quantityOrdered: string;
  unitCost: string;
  notes?: string | null;
  actorUserId?: number;
}

export async function addLine(db: Database, input: AddPoLineInput): Promise<PoLine> {
  return db.transaction(async (tx) => {
    const po = await loadPo(tx, input.poId);
    if (po.status !== "draft" && po.status !== "sent" && po.status !== "confirmed") {
      throw new BusinessRuleError("po_locked", `Cannot add lines to PO in status=${po.status}`);
    }
    const [line] = await tx
      .insert(schema.purchaseOrderLines)
      .values({
        poId: input.poId,
        materialVariantId: input.materialVariantId,
        quantityOrdered: input.quantityOrdered,
        unitCost: input.unitCost,
        notes: input.notes ?? null,
      })
      .returning();
    if (!line)
      throw new InternalError("purchase_order_line insert returned no row");

    await recordAudit({
      db: tx,
      entityType: "po_line",
      entityId: line.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: line,
    });
    return line;
  });
}

export async function sendPo(db: Database, id: number, actorUserId?: number): Promise<Po> {
  return transitionPo(db, id, "draft", "sent", actorUserId);
}

export async function confirmPo(db: Database, id: number, actorUserId?: number): Promise<Po> {
  return transitionPo(db, id, "sent", "confirmed", actorUserId);
}

async function transitionPo(
  db: Database,
  id: number,
  from: schema.PoStatus,
  to: schema.PoStatus,
  actorUserId?: number,
): Promise<Po> {
  return db.transaction(async (tx) => {
    const before = await loadPo(tx, id);
    if (before.status !== from) {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot move PO from ${before.status} to ${to}`,
      );
    }
    const update: Record<string, unknown> = { status: to, updatedAt: new Date() };
    if (to === "sent") update.orderedAt = new Date();
    const [after] = await tx
      .update(schema.purchaseOrders)
      .set(update)
      .where(eq(schema.purchaseOrders.id, id))
      .returning();
    if (!after) throw new NotFoundError("purchase_order", id);

    await recordAudit({
      db: tx,
      entityType: "purchase_order",
      entityId: id,
      action: `state_transition:${from}->${to}`,
      actorUserId,
      before,
      after,
    });
    return after;
  });
}

async function loadPo(db: DbExecutor, id: number): Promise<Po> {
  const [po] = await db
    .select()
    .from(schema.purchaseOrders)
    .where(eq(schema.purchaseOrders.id, id));
  if (!po) throw new NotFoundError("purchase_order", id);
  return po;
}

export async function getPo(db: Database, id: number): Promise<Po & { lines: PoLine[] }> {
  const po = await loadPo(db, id);
  const lines = await db
    .select()
    .from(schema.purchaseOrderLines)
    .where(eq(schema.purchaseOrderLines.poId, id));
  return { ...po, lines };
}

export async function listPos(db: Database): Promise<Po[]> {
  return db
    .select()
    .from(schema.purchaseOrders)
    .orderBy(sql`created_at desc`);
}

export async function recalculatePoStatus(db: DbExecutor, poId: number): Promise<schema.PoStatus> {
  // Compute received quantities and update PO status accordingly.
  const lines = await db
    .select()
    .from(schema.purchaseOrderLines)
    .where(eq(schema.purchaseOrderLines.poId, poId));
  if (lines.length === 0) return "draft";

  const receipts = await db
    .select({
      poLineId: schema.materialLots.poLineId,
      received: sql<string>`COALESCE(SUM(${schema.materialLots.quantityReceived}), 0)`,
    })
    .from(schema.materialLots)
    .where(
      inArray(
        schema.materialLots.poLineId,
        lines.map((l) => l.id),
      ),
    )
    .groupBy(schema.materialLots.poLineId);

  const receivedByLine = new Map<number, number>();
  for (const r of receipts) {
    if (r.poLineId != null) receivedByLine.set(r.poLineId, Number(r.received));
  }

  let allComplete = true;
  let anyPartial = false;
  for (const line of lines) {
    const received = receivedByLine.get(line.id) ?? 0;
    if (received <= 0) allComplete = false;
    else if (received < Number(line.quantityOrdered)) {
      allComplete = false;
      anyPartial = true;
    } else {
      anyPartial = true;
    }
  }

  const newStatus: schema.PoStatus = allComplete
    ? "received"
    : anyPartial
      ? "partial"
      : "confirmed";

  await db
    .update(schema.purchaseOrders)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(schema.purchaseOrders.id, poId));
  return newStatus;
}
