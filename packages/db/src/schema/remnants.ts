import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { cutTicketLots } from "./cut-tickets";
import { materialLots } from "./lots";

export const REMNANT_STATUSES = ["available", "reissued", "scrap"] as const;
export const remnantStatusEnum = pgEnum("remnant_status", REMNANT_STATUSES);

export const remnants = pgTable(
  "remnants",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    parentLotId: bigint("parent_lot_id", { mode: "number" })
      .notNull()
      .references(() => materialLots.id),
    cutTicketLotId: bigint("cut_ticket_lot_id", { mode: "number" })
      .notNull()
      .references(() => cutTicketLots.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    dimensions: jsonb("dimensions"),
    locationBin: text("location_bin"),
    status: remnantStatusEnum("status").notNull().default("available"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parentLotIdx: index("remnants_parent_lot_idx").on(t.parentLotId),
    availableIdx: index("remnants_available_idx")
      .on(t.status)
      .where(sql`${t.status} = 'available'`),
  }),
);

export type Remnant = typeof remnants.$inferSelect;
export type NewRemnant = typeof remnants.$inferInsert;
