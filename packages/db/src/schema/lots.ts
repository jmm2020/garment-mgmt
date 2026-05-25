import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { materialVariants } from "./materials";
import { purchaseOrderLines } from "./purchase-orders";
import { users } from "./users";

export const QUALITY_STATUSES = ["pending_qc", "passed", "quarantined", "rejected"] as const;
export const MOVEMENT_TYPES = [
  "receipt",
  "consumption",
  "adjustment",
  "transfer",
  "scrap",
  "remnant_return",
] as const;

export const qualityStatusEnum = pgEnum("quality_status", QUALITY_STATUSES);
export const movementTypeEnum = pgEnum("movement_type", MOVEMENT_TYPES);

export const materialLots = pgTable(
  "material_lots",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    materialVariantId: bigint("material_variant_id", { mode: "number" })
      .notNull()
      .references(() => materialVariants.id),
    lotCode: text("lot_code").notNull(),
    dyeLot: text("dye_lot"),
    rollNumber: text("roll_number"),
    countryOfOrigin: char("country_of_origin", { length: 2 }),
    quantityReceived: numeric("quantity_received", { precision: 12, scale: 3 }).notNull(),
    quantityRemaining: numeric("quantity_remaining", { precision: 12, scale: 3 }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    receivedByUserId: bigint("received_by_user_id", { mode: "number" }).references(() => users.id),
    poLineId: bigint("po_line_id", { mode: "number" }).references(() => purchaseOrderLines.id),
    certData: jsonb("cert_data"),
    qualityStatus: qualityStatusEnum("quality_status").notNull().default("pending_qc"),
    defectsNotes: text("defects_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    variantLotUnique: uniqueIndex("material_lots_variant_lot_unique").on(
      t.materialVariantId,
      t.lotCode,
    ),
    variantReceivedIdx: index("material_lots_variant_received_idx").on(
      t.materialVariantId,
      t.receivedAt,
    ),
    dyeLotIdx: index("material_lots_dye_lot_idx")
      .on(t.dyeLot)
      .where(sql`${t.dyeLot} IS NOT NULL`),
    qualityIdx: index("material_lots_quality_idx")
      .on(t.qualityStatus)
      .where(sql`${t.qualityStatus} <> 'rejected'`),
    qtyRemainingNonNeg: check(
      "material_lots_qty_remaining_nonneg",
      sql`${t.quantityRemaining} >= 0`,
    ),
  }),
);

export const lotMovements = pgTable(
  "lot_movements",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    lotId: bigint("lot_id", { mode: "number" })
      .notNull()
      .references(() => materialLots.id, { onDelete: "cascade" }),
    movementType: movementTypeEnum("movement_type").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    referenceType: text("reference_type"),
    referenceId: bigint("reference_id", { mode: "number" }),
    actorUserId: bigint("actor_user_id", { mode: "number" }).references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lotCreatedIdx: index("lot_movements_lot_created_idx").on(t.lotId, t.createdAt),
    refIdx: index("lot_movements_ref_idx").on(t.referenceType, t.referenceId),
  }),
);

export type MaterialLot = typeof materialLots.$inferSelect;
export type NewMaterialLot = typeof materialLots.$inferInsert;
export type LotMovement = typeof lotMovements.$inferSelect;
export type NewLotMovement = typeof lotMovements.$inferInsert;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];
export type MovementType = (typeof MOVEMENT_TYPES)[number];
