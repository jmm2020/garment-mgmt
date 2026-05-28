import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
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
// index is the hard concurrency guard; onConflictDoNothing drops a duplicate even if
// two deliveries race past the early-return check below. The early-return is a perf
// optimisation only — it avoids a pointless FIFO walk on confirmed replays.
//
// Known concurrency window: two concurrent deliveries for *different* order IDs can both
// pass the early-return check and both enter db.transaction. Under READ COMMITTED each
// sees the other's pre-commit FIFO state; the unique index on the insert is the safety
// net. Impact is a data-quality edge case (possible over-allocation on high-replay load),
// not financial loss. Revisit with SELECT ... FOR UPDATE on batch rows if this table is
// ever used for hard capacity planning.
export async function processOrderWebhook(
  db: Database,
  payload: ShopifyOrderPayload,
  log?: { warn(obj: object, msg: string): void },
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
      if (!variant) {
        log?.warn(
          { shopifyOrderId: payload.id, lineItemId: line.id, sku },
          "line item SKU not found in Hub — skipping",
        );
        continue;
      }

      const allocations = await assignFifoBatches(tx, variant.id, line.quantity);
      if (allocations.length === 0) {
        log?.warn(
          { shopifyOrderId: payload.id, lineItemId: line.id, sku },
          "no completed inventory for SKU — line item unattributed",
        );
        continue;
      }

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

// FIFO assignment by completed_at ASC (id as tiebreaker for same-millisecond completions).
// Each candidate batch's remaining capacity is its qty_actual minus the sum of all prior
// shopify_order_line_batches.qty against it, so the algorithm survives multiple orders
// consuming the same batch over time.
// Float conversion: inputs have ≤3 dp and each take is pinned to .toFixed(3). The guard
// uses 0.0005 (half the minimum 0.001 increment) instead of 0 to absorb IEEE-754 epsilon
// left in `remaining` after a sequence of fractional subtractions sums to exactly qtyNeeded.
export async function assignFifoBatches(
  tx: DbExecutor,
  variantId: number,
  qtyNeeded: number,
): Promise<FifoAllocation[]> {
  if (!(qtyNeeded > 0)) return [];

  // Single query: completed batches with their already-allocated qty pre-computed via LEFT
  // JOIN + GROUP BY. This eliminates N+1 round-trips for variants with many completed
  // batches. HAVING pre-filters to batches with positive remaining capacity, so the JS
  // loop only iterates over candidates that can still absorb units.
  const candidates = await tx
    .select({
      id: schema.productionBatches.id,
      qtyActual: schema.productionBatches.qtyActual,
      alreadyAllocated: sql<string>`COALESCE(SUM(${schema.shopifyOrderLineBatches.qty}), 0)`,
    })
    .from(schema.productionBatches)
    .leftJoin(
      schema.shopifyOrderLineBatches,
      eq(schema.shopifyOrderLineBatches.batchId, schema.productionBatches.id),
    )
    .where(
      and(
        eq(schema.productionBatches.status, "completed"),
        eq(schema.productionBatches.productVariantId, variantId),
        isNotNull(schema.productionBatches.qtyActual),
      ),
    )
    .groupBy(schema.productionBatches.id, schema.productionBatches.qtyActual)
    .having(
      sql`${schema.productionBatches.qtyActual} - COALESCE(SUM(${schema.shopifyOrderLineBatches.qty}), 0) > 0`,
    )
    .orderBy(asc(schema.productionBatches.completedAt), asc(schema.productionBatches.id));

  let remaining = qtyNeeded;
  const allocations: FifoAllocation[] = [];
  for (const batch of candidates) {
    if (remaining < 0.0005) break;
    const available = Number(batch.qtyActual) - Number(batch.alreadyAllocated);
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
