import { bigint, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { products } from "./products";

export const markers = pgTable("markers", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  productId: bigint("product_id", { mode: "number" })
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  sizeRange: text("size_range"),
  widthInches: numeric("width_inches", { precision: 5, scale: 2 }).notNull(),
  lengthInches: numeric("length_inches", { precision: 6, scale: 2 }).notNull(),
  efficiencyPct: numeric("efficiency_pct", { precision: 5, scale: 2 }).notNull(),
  fabricRequiredPerUnit: numeric("fabric_required_per_unit", { precision: 8, scale: 4 }),
  fileRef: text("file_ref"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Marker = typeof markers.$inferSelect;
export type NewMarker = typeof markers.$inferInsert;
