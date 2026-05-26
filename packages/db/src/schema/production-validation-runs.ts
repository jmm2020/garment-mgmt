import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { cutTickets } from "./cut-tickets";
import { markers } from "./markers";
import { productVariants } from "./products";
import { users } from "./users";

// Status graph (see docs/prd/production-tracking.md §"Production Validation Testing"):
//
//   cutting → shipped → inspecting → validated   (terminal — production authorized)
//                                  → rejected    (terminal — must cut a new PVT)
//   (any non-terminal) ─────────────► cancelled
//
// `validated`, `rejected`, and `cancelled` are terminal. Transitions are validated by
// named functions in pvt-service.ts.
export const PVT_STATUSES = [
  "cutting",
  "shipped",
  "inspecting",
  "validated",
  "rejected",
  "cancelled",
] as const;

export const pvtStatusEnum = pgEnum("pvt_status", PVT_STATUSES);

export const productionValidationRuns = pgTable(
  "production_validation_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // PVT-YYYY-#### (sequential per year). Printed on the sample tag, scanned by validators.
    runNo: text("run_no").notNull().unique(),
    productVariantId: bigint("product_variant_id", { mode: "number" })
      .notNull()
      .references(() => productVariants.id),
    // Pattern/marker that's being validated. Changing the marker invalidates prior PVTs
    // for the same variant — the gate keys on (variantId, markerId).
    markerId: bigint("marker_id", { mode: "number" })
      .notNull()
      .references(() => markers.id),
    // The cut ticket that produced the sample. cutTickets.kind='pvt' for this row.
    cutTicketId: bigint("cut_ticket_id", { mode: "number" })
      .notNull()
      .references(() => cutTickets.id),
    status: pvtStatusEnum("status").notNull().default("cutting"),
    cutterUserId: bigint("cutter_user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    validatorUserId: bigint("validator_user_id", { mode: "number" }).references(() => users.id),
    cutAt: timestamp("cut_at", { withTimezone: true }).notNull().defaultNow(),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // expires_at = validated_at + (product.pvt_validity_months || env default). Set only
    // when status becomes 'validated'; checked by assertPvtCurrent() before batch creation.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    validityMonths: integer("validity_months"),
    rejectedReason: text("rejected_reason"),
    cancelReason: text("cancel_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runNoIdx: uniqueIndex("production_validation_runs_run_no_idx").on(t.runNo),
    statusIdx: index("production_validation_runs_status_idx").on(t.status),
    variantMarkerIdx: index("production_validation_runs_variant_marker_idx").on(
      t.productVariantId,
      t.markerId,
      t.status,
      t.expiresAt,
    ),
    cutTicketIdx: index("production_validation_runs_cut_ticket_idx").on(t.cutTicketId),
  }),
);

export type ProductionValidationRun = typeof productionValidationRuns.$inferSelect;
export type NewProductionValidationRun = typeof productionValidationRuns.$inferInsert;
export type PvtStatus = (typeof PVT_STATUSES)[number];
