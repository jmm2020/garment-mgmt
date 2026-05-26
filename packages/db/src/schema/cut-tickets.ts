import {
  bigint,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { bomComponents, boms } from "./boms";
import { materialLots } from "./lots";
import { markers } from "./markers";
import { products } from "./products";
import { users } from "./users";

export const CUT_TICKET_STATUSES = [
  "draft",
  "allocated",
  "in_cutting",
  "cut",
  "distributed",
  "closed",
  "cancelled",
] as const;

export const cutTicketStatusEnum = pgEnum("cut_ticket_status", CUT_TICKET_STATUSES);

// Discriminator so PVT-sample cuts don't pollute production cut-ticket listings
// and so production-batch creation can refuse to consume a 'pvt' cut by mistake.
export const CUT_TICKET_KINDS = ["production", "pvt"] as const;
export const cutTicketKindEnum = pgEnum("cut_ticket_kind", CUT_TICKET_KINDS);

export const cutTickets = pgTable(
  "cut_tickets",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    ticketNumber: text("ticket_number").notNull().unique(),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => products.id),
    bomId: bigint("bom_id", { mode: "number" })
      .notNull()
      .references(() => boms.id),
    markerId: bigint("marker_id", { mode: "number" }).references(() => markers.id),
    kind: cutTicketKindEnum("kind").notNull().default("production"),
    status: cutTicketStatusEnum("status").notNull().default("draft"),
    plannedQuantityBySize: jsonb("planned_quantity_by_size").notNull(),
    targetCompletionAt: date("target_completion_at"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdByUserId: bigint("created_by_user_id", { mode: "number" }).references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusTargetIdx: index("cut_tickets_status_target_idx").on(t.status, t.targetCompletionAt),
  }),
);

export const cutTicketLots = pgTable(
  "cut_ticket_lots",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    cutTicketId: bigint("cut_ticket_id", { mode: "number" })
      .notNull()
      .references(() => cutTickets.id, { onDelete: "cascade" }),
    materialLotId: bigint("material_lot_id", { mode: "number" })
      .notNull()
      .references(() => materialLots.id),
    bomComponentId: bigint("bom_component_id", { mode: "number" })
      .notNull()
      .references(() => bomComponents.id),
    plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 3 }).notNull(),
    actualQuantityCut: numeric("actual_quantity_cut", { precision: 12, scale: 3 }),
    actualQuantityReturned: numeric("actual_quantity_returned", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cutTicketIdx: index("cut_ticket_lots_ticket_idx").on(t.cutTicketId),
    lotIdx: index("cut_ticket_lots_lot_idx").on(t.materialLotId),
  }),
);

export type CutTicket = typeof cutTickets.$inferSelect;
export type NewCutTicket = typeof cutTickets.$inferInsert;
export type CutTicketLot = typeof cutTicketLots.$inferSelect;
export type NewCutTicketLot = typeof cutTicketLots.$inferInsert;
export type CutTicketStatus = (typeof CUT_TICKET_STATUSES)[number];
export type CutTicketKind = (typeof CUT_TICKET_KINDS)[number];
