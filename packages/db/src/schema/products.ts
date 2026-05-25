import {
  bigint,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const PRODUCT_STATUSES = [
  "in_design",
  "sampling",
  "approved",
  "in_production",
  "retired",
] as const;

export const productStatusEnum = pgEnum("product_status", PRODUCT_STATUSES);

export const products = pgTable("products", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  styleCode: text("style_code").notNull().unique(),
  name: text("name").notNull(),
  season: text("season"),
  status: productStatusEnum("status").notNull().default("in_design"),
  baseSamMinutes: numeric("base_sam_minutes", { precision: 8, scale: 3 }),
  targetCogsCents: integer("target_cogs_cents"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productVariants = pgTable(
  "product_variants",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    size: text("size").notNull(),
    colorway: text("colorway").notNull(),
    fgSku: text("fg_sku").notNull().unique(),
    upc: text("upc"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    productSizeColorIdx: uniqueIndex("product_variants_unique_idx").on(
      t.productId,
      t.size,
      t.colorway,
    ),
  }),
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
