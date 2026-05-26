import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { cutTickets } from "./cut-tickets";
import { productVariants } from "./products";
import { users } from "./users";

// Status graph (see docs/prd/production-tracking.md):
//
//   received_from_cutter → staged_pre_prod → in_production → awaiting_qc → completed
//                                            (any non-terminal) ────────► cancelled
//
// `completed` and `cancelled` are terminal. Transitions are validated by named functions
// in production-batch-service.ts; this enum is just the storage shape.
export const PRODUCTION_BATCH_STATUSES = [
  "received_from_cutter",
  "staged_pre_prod",
  "in_production",
  "awaiting_qc",
  "completed",
  "cancelled",
] as const;

export const productionBatchStatusEnum = pgEnum(
  "production_batch_status",
  PRODUCTION_BATCH_STATUSES,
);

export const QC_VERDICTS = ["pass", "fail", "pass_with_notes"] as const;
export const qcVerdictEnum = pgEnum("qc_verdict", QC_VERDICTS);

export const productionBatches = pgTable(
  "production_batches",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // PB-YYYY-#### (sequential per year). Operator-facing identifier; printed on floor tags.
    batchNo: text("batch_no").notNull().unique(),
    cutTicketId: bigint("cut_ticket_id", { mode: "number" })
      .notNull()
      .references(() => cutTickets.id),
    productVariantId: bigint("product_variant_id", { mode: "number" })
      .notNull()
      .references(() => productVariants.id),
    status: productionBatchStatusEnum("status").notNull().default("received_from_cutter"),
    qtyPlanned: numeric("qty_planned", { precision: 12, scale: 3 }).notNull(),
    // Set when the operator submits for QC and finalized on `completed`.
    qtyActual: numeric("qty_actual", { precision: 12, scale: 3 }),
    cutterUserId: bigint("cutter_user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    qcUserId: bigint("qc_user_id", { mode: "number" }).references(() => users.id),
    qcVerdict: qcVerdictEnum("qc_verdict"),
    // One timestamp per transition; null until that station is reached.
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    stagedAt: timestamp("staged_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    submittedQcAt: timestamp("submitted_qc_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    // Idempotency marker for Shopify push. NULL until the background job successfully posts.
    shopifyPushedAt: timestamp("shopify_pushed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    batchNoIdx: uniqueIndex("production_batches_batch_no_idx").on(t.batchNo),
    statusIdx: index("production_batches_status_idx").on(t.status),
    cutTicketIdx: index("production_batches_cut_ticket_idx").on(t.cutTicketId),
    variantIdx: index("production_batches_variant_idx").on(t.productVariantId),
    // Reconciliation query: find completed batches not yet pushed to Shopify.
    pendingShopifyIdx: index("production_batches_pending_shopify_idx")
      .on(t.completedAt)
      .where(sql`status = 'completed' AND shopify_pushed_at IS NULL`),
  }),
);

export type ProductionBatch = typeof productionBatches.$inferSelect;
export type NewProductionBatch = typeof productionBatches.$inferInsert;
export type ProductionBatchStatus = (typeof PRODUCTION_BATCH_STATUSES)[number];
export type QcVerdict = (typeof QC_VERDICTS)[number];
