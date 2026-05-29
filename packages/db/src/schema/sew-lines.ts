import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Floor topology for production batches (see ADR-0008). A sew_line is a physical line; a
// machine lives on exactly one line. Batches are assigned to lines (metadata, not a status
// change) via production_batches.sew_line_id — that FK is declared on production-batches.ts to
// keep the import direction one-way (production_batches → sew_lines).
export const MACHINE_TYPES = [
  "flatlock",
  "coverstitch",
  "single_needle",
  "overlock",
  "bartack",
  "other",
] as const;

export const MACHINE_STATUSES = ["available", "in_use", "maintenance"] as const;

export const machineTypeEnum = pgEnum("machine_type", MACHINE_TYPES);
export const machineStatusEnum = pgEnum("machine_status", MACHINE_STATUSES);

export const sewLines = pgTable(
  "sew_lines",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    capacityUnitsPerDay: integer("capacity_units_per_day").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex("sew_lines_code_idx").on(t.code),
    activeIdx: index("sew_lines_active_idx").on(t.active),
  }),
);

export const machines = pgTable(
  "machines",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    code: text("code").notNull().unique(),
    type: machineTypeEnum("type").notNull(),
    sewLineId: bigint("sew_line_id", { mode: "number" })
      .notNull()
      .references(() => sewLines.id, { onDelete: "restrict" }),
    status: machineStatusEnum("status").notNull().default("available"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex("machines_code_idx").on(t.code),
    lineIdx: index("machines_line_idx").on(t.sewLineId),
    lineStatusIdx: index("machines_line_status_idx").on(t.sewLineId, t.status),
  }),
);

export type SewLine = typeof sewLines.$inferSelect;
export type NewSewLine = typeof sewLines.$inferInsert;
export type Machine = typeof machines.$inferSelect;
export type NewMachine = typeof machines.$inferInsert;
export type MachineType = (typeof MACHINE_TYPES)[number];
export type MachineStatus = (typeof MACHINE_STATUSES)[number];
