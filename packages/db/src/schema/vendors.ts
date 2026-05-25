import { bigint, char, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const VENDOR_TYPES = [
  "mill",
  "trim_supplier",
  "dye_house",
  "cut_make",
  "notion",
  "label",
  "other",
] as const;

export const VENDOR_STATUSES = ["active", "archived"] as const;

export const vendorTypeEnum = pgEnum("vendor_type", VENDOR_TYPES);
export const vendorStatusEnum = pgEnum("vendor_status", VENDOR_STATUSES);

export const vendors = pgTable("vendors", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  vendorType: vendorTypeEnum("vendor_type").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  address: jsonb("address"),
  certifications: jsonb("certifications").notNull().default({}),
  country: char("country", { length: 2 }),
  status: vendorStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;
export type VendorType = (typeof VENDOR_TYPES)[number];
