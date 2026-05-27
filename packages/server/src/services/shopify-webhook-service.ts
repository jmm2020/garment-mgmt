import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { recordAudit } from "./audit-service.js";

// Shape we consume from a Shopify orders/create payload. The webhook route validates
// the wire payload with Zod; this is the post-parse contract the service expects.
export interface ShopifyOrderPayload {
  id: string;
  line_items: Array<{
    id: string;
    sku?: string | null;
    quantity: number;
  }>;
}

export interface ForensicRow {
  shopifyOrderId: string;
  lineItemId: string;
  qty: string;
  batchNo: string;
  cutTicketId: number;
  cutTicketNo: string;
  fabricLotIds: number[];
}

interface FifoAllocation {
  batchId: number;
  qty: string;
}

// Idempotent webhook entry point. The (shopify_order_id, line_item_id, batch_id) unique
// index makes a duplicate insert a no-op; we ALSO short-circuit at the top to avoid
// pointlessly walking the FIFO query a second time for a Shopify replay.
export async function processOrderWebhook(
  db: Database,
  payload: ShopifyOrderPayload,
): Promise<void> {
  const existing = await db
    .select({ id: schema.shopifyOrderLineBatches.id })
    .from(schema.shopifyOrderLineBatches)
    .where(eq(schema.shopifyOrderLineBatches.shopifyOrderId, payload.id))
    .limit(1);
  if (existing.length > 0) return;

  await db.transaction(async (tx) => {
    for (const line of payload.line_items) {
      const sku = line.sku;
      if (!sku) continue;

      const [variant] = await tx
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.sku, sku));
      if (!variant) continue;

      const allocations = await assignFifoBatches(tx, variant.id, line.quantity);
      if (allocations.length === 0) continue;

      for (const alloc of allocations) {
        const [row] = await tx
          .insert(schema.shopifyOrderLineBatches)
          .values({
            shopifyOrderId: payload.id,
            lineItemId: line.id,
            batchId: alloc.batchId,
            qty: alloc.qty,
          })
          .onConflictDoNothing({
            target: [
              schema.shopifyOrderLineBatches.shopifyOrderId,
              schema.shopifyOrderLineBatches.lineItemId,
              schema.shopifyOrderLineBatches.batchId,
            ],
          })
          .returning();
        if (!row) continue;
        await recordAudit({
          db: tx,
          entityType: "shopify_order_line_batch",
          entityId: row.id,
          action: "shopify.order.line.assigned",
          after: row,
        });
      }
    }
  });
}

// FIFO assignment by completed_at ASC. Each candidate batch's remaining capacity is its
// qty_actual minus the sum of all prior shopify_order_line_batches.qty against it, so the
// algorithm survives multiple orders consuming the same batch over time.
export async function assignFifoBatches(
  tx: DbExecutor,
  variantId: number,
  qtyNeeded: number,
): Promise<FifoAllocation[]> {
  if (!(qtyNeeded > 0)) return [];
  const candidates = await tx
    .select({
      id: schema.productionBatches.id,
      qtyActual: schema.productionBatches.qtyActual,
    })
    .from(schema.productionBatches)
    .where(
      and(
        eq(schema.productionBatches.status, "completed"),
        eq(schema.productionBatches.productVariantId, variantId),
      ),
    )
    .orderBy(asc(schema.productionBatches.completedAt));

  let remaining = qtyNeeded;
  const allocations: FifoAllocation[] = [];

  for (const batch of candidates) {
    if (remaining <= 0) break;
    if (!batch.qtyActual) continue;

    const [allocatedRow] = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${schema.shopifyOrderLineBatches.qty}), 0)`,
      })
      .from(schema.shopifyOrderLineBatches)
      .where(eq(schema.shopifyOrderLineBatches.batchId, batch.id));

    const alreadyAllocated = Number(allocatedRow?.total ?? 0);
    const available = Number(batch.qtyActual) - alreadyAllocated;
    if (available <= 0) continue;

    const take = Math.min(available, remaining);
    allocations.push({ batchId: batch.id, qty: take.toFixed(3) });
    remaining -= take;
  }

  return allocations;
}

export async function findBatchesByOrder(
  db: Database,
  shopifyOrderId: string,
): Promise<ForensicRow[]> {
  const rows = await db.execute<{
    shopify_order_id: string;
    line_item_id: string;
    qty: string;
    batch_no: string;
    cut_ticket_id: number;
    cut_ticket_no: string;
    fabric_lot_ids: Array<number | null> | null;
  }>(sql`
    SELECT solb.shopify_order_id,
           solb.line_item_id,
           solb.qty,
           pb.batch_no,
           pb.cut_ticket_id,
           ct.ticket_number AS cut_ticket_no,
           ARRAY_AGG(DISTINCT ctl.material_lot_id) AS fabric_lot_ids
      FROM shopify_order_line_batches solb
      JOIN production_batches pb ON pb.id = solb.batch_id
      JOIN cut_tickets ct ON ct.id = pb.cut_ticket_id
      LEFT JOIN cut_ticket_lots ctl ON ctl.cut_ticket_id = pb.cut_ticket_id
     WHERE solb.shopify_order_id = ${shopifyOrderId}
     GROUP BY solb.id, solb.shopify_order_id, solb.line_item_id, solb.qty,
              pb.batch_no, pb.cut_ticket_id, ct.ticket_number
     ORDER BY solb.line_item_id, pb.batch_no
  `);

  return rows.map((r) => ({
    shopifyOrderId: r.shopify_order_id,
    lineItemId: r.line_item_id,
    qty: r.qty,
    batchNo: r.batch_no,
    cutTicketId: Number(r.cut_ticket_id),
    cutTicketNo: r.cut_ticket_no,
    fabricLotIds: (r.fabric_lot_ids ?? [])
      .map((id) => (id == null ? Number.NaN : Number(id)))
      .filter((id) => Number.isFinite(id)),
  }));
}
