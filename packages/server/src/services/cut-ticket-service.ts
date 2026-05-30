import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { and, eq, sql } from "drizzle-orm";
import {
  BusinessRuleError,
  InternalError,
  NotFoundError,
  ValidationFailedError,
} from "../errors.js";
import { recordAudit } from "./audit-service.js";
import { componentsForCutTicket } from "./bom-service.js";

type CutTicket = schema.CutTicket;
type CutTicketLot = schema.CutTicketLot;

export interface CreateCutTicketInput {
  productId: number;
  bomId: number;
  markerId?: number | null;
  plannedQuantityBySize: Record<string, number>;
  ticketNumber: string;
  targetCompletionAt?: string | null;
  notes?: string | null;
  allowDyeLotSplit?: boolean;
  actorUserId?: number;
}

export interface CutTicketWithAllocations extends CutTicket {
  allocations: CutTicketLot[];
}

export async function createCutTicket(
  db: Database,
  input: CreateCutTicketInput,
): Promise<CutTicketWithAllocations> {
  return db.transaction(async (tx) => {
    const [bom] = await tx.select().from(schema.boms).where(eq(schema.boms.id, input.bomId));
    if (!bom) throw new NotFoundError("bom", input.bomId);
    if (bom.productId !== input.productId) {
      throw new BusinessRuleError("bom_product_mismatch", "BOM does not belong to product");
    }
    if (bom.status !== "active") {
      throw new BusinessRuleError("bom_not_active", `BOM must be active (got ${bom.status})`);
    }

    const [ticket] = await tx
      .insert(schema.cutTickets)
      .values({
        ticketNumber: input.ticketNumber,
        productId: input.productId,
        bomId: input.bomId,
        markerId: input.markerId ?? null,
        plannedQuantityBySize: input.plannedQuantityBySize,
        targetCompletionAt: input.targetCompletionAt ?? null,
        createdByUserId: input.actorUserId,
        notes: input.notes ?? null,
      })
      .returning();
    if (!ticket) throw new InternalError("cut_ticket insert returned no row");

    const requirements = await componentsForCutTicket(tx, input.bomId, input.plannedQuantityBySize);

    const allocations: CutTicketLot[] = [];

    for (const req of requirements) {
      // SELECT ... FOR UPDATE to prevent concurrent allocators racing for the same lots
      const lots = await tx.execute<{
        id: number;
        dye_lot: string | null;
        quantity_remaining: string;
        received_at: Date;
      }>(sql`
        SELECT id, dye_lot, quantity_remaining, received_at
        FROM material_lots
        WHERE material_variant_id = ${req.materialVariantId}
          AND quantity_remaining > 0
          AND quality_status = 'passed'
        ORDER BY received_at ASC, id ASC
        FOR UPDATE
      `);
      const candidates = lots.map((row) => ({
        id: row.id,
        dyeLot: row.dye_lot,
        remaining: Number(row.quantity_remaining),
        receivedAt: row.received_at,
      }));

      const need = req.totalQuantity;
      if (candidates.length === 0) {
        throw new BusinessRuleError(
          "no_lots_available",
          `No passed lots available for material_variant_id=${req.materialVariantId}`,
        );
      }

      const picks =
        req.isVisiblePanel && !input.allowDyeLotSplit
          ? pickSingleDyeLot(candidates, need, req.materialVariantId)
          : pickFifo(candidates, need, req.materialVariantId);

      for (const pick of picks) {
        const [allocation] = await tx
          .insert(schema.cutTicketLots)
          .values({
            cutTicketId: ticket.id,
            materialLotId: pick.lotId,
            bomComponentId: req.bomComponentId,
            plannedQuantity: pick.quantity.toFixed(3),
          })
          .returning();
        if (!allocation) throw new InternalError("cut_ticket_lot insert returned no row");
        allocations.push(allocation);

        // Decrement quantity_remaining inside the FOR UPDATE window so concurrent
        // allocators see the reservation. CHECK constraint material_lots_qty_remaining_nonneg
        // is the final guard against double-spend.
        await tx
          .update(schema.materialLots)
          .set({
            quantityRemaining: sql`${schema.materialLots.quantityRemaining} - ${pick.quantity.toFixed(3)}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(schema.materialLots.id, pick.lotId));
      }
    }

    const [allocated] = await tx
      .update(schema.cutTickets)
      .set({ status: "allocated", updatedAt: new Date() })
      .where(eq(schema.cutTickets.id, ticket.id))
      .returning();
    if (!allocated) throw new InternalError("cut_ticket update returned no row");

    await recordAudit({
      db: tx,
      entityType: "cut_ticket",
      entityId: ticket.id,
      action: "state_transition:draft->allocated",
      actorUserId: input.actorUserId,
      after: { ticket: allocated, allocations },
    });

    return { ...allocated, allocations };
  });
}

export interface Candidate {
  id: number;
  dyeLot: string | null;
  remaining: number;
  receivedAt: Date;
}

export interface Pick {
  lotId: number;
  quantity: number;
}

export function pickFifo(candidates: Candidate[], need: number, materialVariantId: number): Pick[] {
  const picks: Pick[] = [];
  let remaining = need;
  for (const c of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(c.remaining, remaining);
    picks.push({ lotId: c.id, quantity: take });
    remaining -= take;
  }
  if (remaining > 1e-6) {
    throw new BusinessRuleError(
      "insufficient_stock",
      `Insufficient stock for material_variant_id=${materialVariantId}: short ${remaining}`,
    );
  }
  return picks;
}

export function pickSingleDyeLot(
  candidates: Candidate[],
  need: number,
  materialVariantId: number,
): Pick[] {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (!c.dyeLot) continue;
    const arr = groups.get(c.dyeLot) ?? [];
    arr.push(c);
    groups.set(c.dyeLot, arr);
  }

  let best: { key: string; total: number; lots: Candidate[] } | null = null;
  for (const [key, lots] of groups) {
    const total = lots.reduce((s, l) => s + l.remaining, 0);
    if (total >= need && (best == null || total < best.total)) {
      best = { key, total, lots: lots.sort((a, b) => +a.receivedAt - +b.receivedAt) };
    }
  }
  if (!best) {
    throw new BusinessRuleError(
      "dye_lot_integrity_violation",
      `No single dye_lot can fulfill ${need} for material_variant_id=${materialVariantId}. ` +
        `Re-issue with allowDyeLotSplit=true to override.`,
    );
  }
  return pickFifo(best.lots, need, materialVariantId);
}

export async function markInCutting(
  db: Database,
  ticketId: number,
  actorUserId?: number,
): Promise<CutTicket> {
  return db.transaction(async (tx) => {
    const before = await loadTicket(tx, ticketId);
    if (before.status !== "allocated") {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot mark in_cutting from ${before.status}`,
      );
    }
    const [after] = await tx
      .update(schema.cutTickets)
      .set({ status: "in_cutting", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.cutTickets.id, ticketId))
      .returning();
    if (!after) throw new NotFoundError("cut_ticket", ticketId);

    await recordAudit({
      db: tx,
      entityType: "cut_ticket",
      entityId: ticketId,
      action: "state_transition:allocated->in_cutting",
      actorUserId,
      before,
      after,
    });
    return after;
  });
}

export interface CloseActual {
  cutTicketLotId: number;
  actualQuantityCut: string;
  actualQuantityReturned?: string;
}

export interface CloseCutTicketInput {
  ticketId: number;
  actuals: CloseActual[];
  actorUserId?: number;
}

export async function closeCutTicket(db: Database, input: CloseCutTicketInput): Promise<CutTicket> {
  return db.transaction(async (tx) => {
    const before = await loadTicket(tx, input.ticketId);
    if (before.status === "closed" || before.status === "cancelled") {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot close cut ticket in status=${before.status}`,
      );
    }

    for (const actual of input.actuals) {
      const [ctLot] = await tx
        .select()
        .from(schema.cutTicketLots)
        .where(
          and(
            eq(schema.cutTicketLots.id, actual.cutTicketLotId),
            eq(schema.cutTicketLots.cutTicketId, input.ticketId),
          ),
        );
      if (!ctLot) throw new NotFoundError("cut_ticket_lot", actual.cutTicketLotId);

      const cut = Number(actual.actualQuantityCut);
      const returned = Number(actual.actualQuantityReturned ?? "0");
      if (cut < 0 || returned < 0) {
        throw new ValidationFailedError("actual quantities must be non-negative");
      }

      const [lot] = await tx
        .select()
        .from(schema.materialLots)
        .where(eq(schema.materialLots.id, ctLot.materialLotId));
      if (!lot) throw new NotFoundError("material_lot", ctLot.materialLotId);

      const planned = Number(ctLot.plannedQuantity);
      // Lot already had `planned` debited at allocation. Reconcile by adding
      // (planned - cut): positive credits unused allocation back, negative is an
      // overrun. Overruns can only proceed if the lot still has stock.
      const adjustment = planned - cut;
      if (adjustment < 0 && -adjustment > Number(lot.quantityRemaining)) {
        throw new BusinessRuleError(
          "consumption_exceeds_lot",
          `Cut ${cut} exceeds planned ${planned} plus remaining ${lot.quantityRemaining} for lot ${lot.id}`,
        );
      }

      await tx
        .update(schema.cutTicketLots)
        .set({
          actualQuantityCut: actual.actualQuantityCut,
          actualQuantityReturned: actual.actualQuantityReturned ?? "0",
        })
        .where(eq(schema.cutTicketLots.id, actual.cutTicketLotId));

      await tx
        .update(schema.materialLots)
        .set({
          quantityRemaining: sql`${schema.materialLots.quantityRemaining} + ${adjustment.toFixed(3)}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(schema.materialLots.id, lot.id));

      if (cut > 0) {
        await tx.insert(schema.lotMovements).values({
          lotId: lot.id,
          movementType: "consumption",
          quantity: (-cut).toFixed(3),
          referenceType: "cut_ticket",
          referenceId: input.ticketId,
          actorUserId: input.actorUserId,
        });
      }

      if (returned > 0) {
        // `cut` already includes the returned quantity (the cutter removed `cut`
        // yards from the parent roll; `returned` is the reusable scrap split out
        // into the remnants table). Per ADR-0003, remnants are tracked as their
        // own inventory items and not re-added to the parent lot, so no parent-
        // lot movement is written here.
        const [remnant] = await tx
          .insert(schema.remnants)
          .values({
            parentLotId: lot.id,
            cutTicketLotId: ctLot.id,
            quantity: returned.toFixed(3),
          })
          .returning();
        if (!remnant) throw new InternalError("remnant insert returned no row");

        await recordAudit({
          db: tx,
          entityType: "remnant",
          entityId: remnant.id,
          action: "create",
          actorUserId: input.actorUserId,
          after: remnant,
        });
      }
    }

    const [after] = await tx
      .update(schema.cutTickets)
      .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.cutTickets.id, input.ticketId))
      .returning();
    if (!after) throw new NotFoundError("cut_ticket", input.ticketId);

    await recordAudit({
      db: tx,
      entityType: "cut_ticket",
      entityId: input.ticketId,
      action: `state_transition:${before.status}->closed`,
      actorUserId: input.actorUserId,
      before,
      after,
    });
    return after;
  });
}

export async function cancelCutTicket(
  db: Database,
  ticketId: number,
  reason: string,
  actorUserId?: number,
): Promise<CutTicket> {
  return db.transaction(async (tx) => {
    const before = await loadTicket(tx, ticketId);
    if (before.status !== "draft" && before.status !== "allocated") {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot cancel cut ticket in status=${before.status}`,
      );
    }

    // Credit allocated quantities back to material lots. Drafts have no
    // allocations yet, so this only matters for allocated tickets.
    if (before.status === "allocated") {
      const ctLots = await tx
        .select()
        .from(schema.cutTicketLots)
        .where(eq(schema.cutTicketLots.cutTicketId, ticketId));
      for (const ctLot of ctLots) {
        await tx
          .update(schema.materialLots)
          .set({
            quantityRemaining: sql`${schema.materialLots.quantityRemaining} + ${ctLot.plannedQuantity}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(schema.materialLots.id, ctLot.materialLotId));
      }
    }

    const [after] = await tx
      .update(schema.cutTickets)
      .set({ status: "cancelled", updatedAt: new Date(), notes: reason })
      .where(eq(schema.cutTickets.id, ticketId))
      .returning();
    if (!after) throw new NotFoundError("cut_ticket", ticketId);

    await recordAudit({
      db: tx,
      entityType: "cut_ticket",
      entityId: ticketId,
      action: `state_transition:${before.status}->cancelled`,
      actorUserId,
      before,
      after,
    });
    return after;
  });
}

async function loadTicket(db: DbExecutor, id: number): Promise<CutTicket> {
  const [ticket] = await db.select().from(schema.cutTickets).where(eq(schema.cutTickets.id, id));
  if (!ticket) throw new NotFoundError("cut_ticket", id);
  return ticket;
}

export async function getCutTicket(
  db: Database,
  id: number,
): Promise<CutTicket & { allocations: CutTicketLot[] }> {
  const ticket = await loadTicket(db, id);
  const allocations = await db
    .select()
    .from(schema.cutTicketLots)
    .where(eq(schema.cutTicketLots.cutTicketId, id));
  return { ...ticket, allocations };
}

export async function listCutTickets(db: Database): Promise<CutTicket[]> {
  return db.select().from(schema.cutTickets);
}
