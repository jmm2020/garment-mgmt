import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { materialVariants, unitOfMeasureEnum } from "./materials";
import { products } from "./products";
import { users } from "./users";

export const BOM_STATUSES = ["draft", "approved", "active", "superseded"] as const;
export const bomStatusEnum = pgEnum("bom_status", BOM_STATUSES);

export const boms = pgTable(
  "boms",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: bomStatusEnum("status").notNull().default("draft"),
    approvedByUserId: bigint("approved_by_user_id", { mode: "number" }).references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    effectiveDate: date("effective_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    productVersionUnique: uniqueIndex("boms_product_version_unique").on(t.productId, t.version),
    activeUnique: uniqueIndex("boms_active_unique_idx")
      .on(t.productId)
      .where(sql`${t.status} = 'active'`),
  }),
);

export const bomComponents = pgTable("bom_components", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  bomId: bigint("bom_id", { mode: "number" })
    .notNull()
    .references(() => boms.id, { onDelete: "cascade" }),
  materialVariantId: bigint("material_variant_id", { mode: "number" })
    .notNull()
    .references(() => materialVariants.id),
  quantityPerUnit: numeric("quantity_per_unit", { precision: 12, scale: 4 }).notNull(),
  unitOfMeasure: unitOfMeasureEnum("unit_of_measure").notNull(),
  position: text("position"),
  isVisiblePanel: boolean("is_visible_panel").notNull().default(false),
  sizeCurve: jsonb("size_curve"),
  wasteFactorPct: numeric("waste_factor_pct", { precision: 5, scale: 2 }).notNull().default("8.00"),
  isOptional: boolean("is_optional").notNull().default(false),
  notes: text("notes"),
});

export type Bom = typeof boms.$inferSelect;
export type NewBom = typeof boms.$inferInsert;
export type BomComponent = typeof bomComponents.$inferSelect;
export type NewBomComponent = typeof bomComponents.$inferInsert;
export type BomStatus = (typeof BOM_STATUSES)[number];
