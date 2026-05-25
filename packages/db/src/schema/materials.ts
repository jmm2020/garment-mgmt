import {
  bigint,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { vendors } from "./vendors";

export const MATERIAL_TYPES = [
  "fabric_shell",
  "fabric_lining",
  "fabric_insulation",
  "zipper",
  "snap",
  "button",
  "thread",
  "label",
  "tape",
  "webbing",
  "elastic",
  "other",
] as const;

export const UNITS_OF_MEASURE = ["yard", "meter", "each", "gram", "kilogram"] as const;
export const MATERIAL_STATUSES = ["active", "archived"] as const;

export const materialTypeEnum = pgEnum("material_type", MATERIAL_TYPES);
export const unitOfMeasureEnum = pgEnum("unit_of_measure", UNITS_OF_MEASURE);
export const materialStatusEnum = pgEnum("material_status", MATERIAL_STATUSES);

export const materials = pgTable("materials", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  materialType: materialTypeEnum("material_type").notNull(),
  unitOfMeasure: unitOfMeasureEnum("unit_of_measure").notNull(),
  composition: jsonb("composition"),
  preferredVendorId: bigint("preferred_vendor_id", { mode: "number" }).references(
    () => vendors.id,
    { onDelete: "set null" },
  ),
  reorderPoint: numeric("reorder_point", { precision: 12, scale: 3 }),
  targetStock: numeric("target_stock", { precision: 12, scale: 3 }),
  notes: text("notes"),
  status: materialStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const materialVariants = pgTable(
  "material_variants",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    materialId: bigint("material_id", { mode: "number" })
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    variantSku: text("variant_sku").notNull(),
    colorway: text("colorway"),
    sizeSpec: text("size_spec"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    variantSkuIdx: uniqueIndex("material_variants_sku_idx").on(t.variantSku),
    matColorIdx: index("material_variants_mat_color_idx").on(t.materialId, t.colorway),
  }),
);

export type Material = typeof materials.$inferSelect;
export type NewMaterial = typeof materials.$inferInsert;
export type MaterialVariant = typeof materialVariants.$inferSelect;
export type NewMaterialVariant = typeof materialVariants.$inferInsert;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];
