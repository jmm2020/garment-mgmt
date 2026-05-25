import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { materialVariants } from "./materials";
import { vendors } from "./vendors";

export const PO_STATUSES = [
  "draft",
  "sent",
  "confirmed",
  "partial",
  "received",
  "closed",
  "cancelled",
] as const;

export const poStatusEnum = pgEnum("po_status", PO_STATUSES);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    poNumber: text("po_number").notNull().unique(),
    vendorId: bigint("vendor_id", { mode: "number" })
      .notNull()
      .references(() => vendors.id),
    status: poStatusEnum("status").notNull().default("draft"),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    expectedAt: date("expected_at"),
    totalEstimated: numeric("total_estimated", { precision: 14, scale: 4 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusExpectedIdx: index("po_status_expected_idx").on(t.status, t.expectedAt),
  }),
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    poId: bigint("po_id", { mode: "number" })
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    materialVariantId: bigint("material_variant_id", { mode: "number" })
      .notNull()
      .references(() => materialVariants.id),
    quantityOrdered: numeric("quantity_ordered", { precision: 12, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 12, scale: 4 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    poIdx: index("po_lines_po_idx").on(t.poId),
    qtyPositive: check("po_lines_qty_positive", sql`${t.quantityOrdered} > 0`),
  }),
);

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type NewPurchaseOrderLine = typeof purchaseOrderLines.$inferInsert;
export type PoStatus = (typeof PO_STATUSES)[number];
