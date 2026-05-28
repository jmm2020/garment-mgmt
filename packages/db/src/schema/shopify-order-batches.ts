import { bigint, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { productionBatches } from "./production-batches";

// One row per (shopify_order_id, line_item_id, batch) tuple. Append-only forensic
// trail produced by the orders/create webhook — no updates, no deletes, no
// updated_at column. Idempotency is enforced by the (order_id, line_item_id, batch_id)
// triple via the unique index below, so a replayed webhook is a no-op at the SQL layer.
export const shopifyOrderLineBatches = pgTable(
  "shopify_order_line_batches",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // Shopify returns numeric IDs that can exceed Number.MAX_SAFE_INTEGER; store as text.
    shopifyOrderId: text("shopify_order_id").notNull(),
    lineItemId: text("line_item_id").notNull(),
    batchId: bigint("batch_id", { mode: "number" })
      .notNull()
      .references(() => productionBatches.id),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderLineBatchIdx: uniqueIndex("shopify_order_line_batches_order_line_batch_idx").on(
      t.shopifyOrderId,
      t.lineItemId,
      t.batchId,
    ),
    orderIdx: index("shopify_order_line_batches_order_idx").on(t.shopifyOrderId),
    batchIdx: index("shopify_order_line_batches_batch_idx").on(t.batchId),
  }),
);

export type ShopifyOrderLineBatch = typeof shopifyOrderLineBatches.$inferSelect;
export type NewShopifyOrderLineBatch = typeof shopifyOrderLineBatches.$inferInsert;
