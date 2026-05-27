import {
  bigint,
  index,
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
  // Per-product override for the PVT validity window. NULL falls back to env
  // PVT_DEFAULT_VALIDITY_MONTHS=6. Volatile lines (frequent fabric swaps) may
  // want 3 months; evergreens cut every few weeks may want 12.
  pvtValidityMonths: integer("pvt_validity_months"),
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
    // Structured FG-SKU dimensions. Allowlists live in product-variant-dimensions.ts
    // and are enforced via Zod at the service layer. The canonical SKU is composed
    // from these via composeSku() and stored in `sku` (unique). See ADR-0005 §3.
    line: text("line"),
    model: text("model"),
    color: text("color"),
    sizeDim: text("size_dim"),
    gender: text("gender"),
    seasonDim: text("season_dim"),
    fabricType: text("fabric_type"),
    sku: text("sku"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Cached Shopify product variant GID (gid://shopify/ProductVariant/...).
    // Populated on first successful metafield write by the push job. NULL until then.
    shopifyVariantGid: text("shopify_variant_gid"),
  },
  (t) => ({
    productSizeColorIdx: uniqueIndex("product_variants_unique_idx").on(
      t.productId,
      t.size,
      t.colorway,
    ),
    skuIdx: uniqueIndex("product_variants_sku_idx").on(t.sku),
    dimensionsIdx: index("product_variants_dimensions_idx").on(
      t.line,
      t.model,
      t.color,
      t.sizeDim,
      t.gender,
      t.seasonDim,
      t.fabricType,
    ),
  }),
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
