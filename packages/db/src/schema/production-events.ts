import { bigint, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { productionBatches } from "./production-batches";
import { users } from "./users";

// Immutable append-only log of every transition a production_batch (or PVT run) passes
// through. Service layer NEVER updates rows here — write once, then nothing. The audit_log
// table is the generic forensic record; this table is the batch-scoped narrative that
// powers `gm batch show <batchNo>` without joining audit_log to deserialize every JSON
// before/after blob.
export const productionEvents = pgTable(
  "production_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    batchId: bigint("batch_id", { mode: "number" })
      .notNull()
      .references(() => productionBatches.id),
    // 'state_transition' | 'qc_decision' | 'shopify_push_succeeded' | 'shopify_push_failed' | ...
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorUserId: bigint("actor_user_id", { mode: "number" }).references(() => users.id),
    // Arbitrary structured payload: qty, verdict, reason, shopify response, etc.
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    batchIdx: index("production_events_batch_idx").on(t.batchId, t.createdAt),
    typeIdx: index("production_events_type_idx").on(t.eventType, t.createdAt),
  }),
);

export type ProductionEvent = typeof productionEvents.$inferSelect;
export type NewProductionEvent = typeof productionEvents.$inferInsert;
