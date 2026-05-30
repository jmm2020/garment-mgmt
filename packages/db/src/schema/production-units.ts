import { bigint, index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { productionBatches, qcVerdictEnum } from "./production-batches";
import { users } from "./users";

// Per-unit lifecycle (additive to batch-level status — units are physical objects,
// batches are workflow states). `shipped` is reserved for iter-4+; no transition
// function or route exposes it in this iteration.
export const PRODUCTION_UNIT_STATUSES = ["created", "qc_passed", "qc_rejected", "shipped"] as const;

export const productionUnitStatusEnum = pgEnum("production_unit_status", PRODUCTION_UNIT_STATUSES);

export const productionUnits = pgTable(
  "production_units",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // U-YYYY-NNNNNN (6-digit, sequential per year). Printed on the hang tag;
    // returning customers reference this to trigger warranty lookup.
    unitSerial: text("unit_serial").notNull().unique(),
    batchId: bigint("batch_id", { mode: "number" })
      .notNull()
      .references(() => productionBatches.id),
    status: productionUnitStatusEnum("status").notNull().default("created"),
    qcVerdict: qcVerdictEnum("qc_verdict"),
    qcRejectedReason: text("qc_rejected_reason"),
    qcActorUserId: bigint("qc_actor_user_id", { mode: "number" }).references(() => users.id),
    qcAt: timestamp("qc_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unitSerialIdx: uniqueIndex("production_units_unit_serial_idx").on(t.unitSerial),
    batchIdx: index("production_units_batch_idx").on(t.batchId),
    batchVerdictIdx: index("production_units_batch_verdict_idx").on(t.batchId, t.qcVerdict),
  }),
);

export type ProductionUnit = typeof productionUnits.$inferSelect;
export type NewProductionUnit = typeof productionUnits.$inferInsert;
export type ProductionUnitStatus = (typeof PRODUCTION_UNIT_STATUSES)[number];
