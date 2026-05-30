import { schema, type Database } from "@garment-mgmt/db";
import { eq } from "drizzle-orm";
import {
  BusinessRuleError,
  InternalError,
  NotFoundError,
  ValidationFailedError,
} from "../errors.js";
import { recordAudit } from "./audit-service.js";
import { recalculatePoStatus } from "./po-service.js";

export interface ReceiveLotDraft {
  lotCode: string;
  dyeLot?: string | null;
  rollNumber?: string | null;
  countryOfOrigin?: string | null;
  quantityReceived: string;
  certData?: unknown;
  qualityStatus?: schema.QualityStatus;
  defectsNotes?: string | null;
}

export interface ReceivePoLineInput {
  poLineId: number;
  lots: ReceiveLotDraft[];
  actorUserId?: number;
}

export interface ReceivePoLineResult {
  poId: number;
  lots: schema.MaterialLot[];
  newPoStatus: schema.PoStatus;
}

export async function receivePoLine(
  db: Database,
  input: ReceivePoLineInput,
): Promise<ReceivePoLineResult> {
  if (input.lots.length === 0) {
    throw new ValidationFailedError("at least one lot required");
  }
  for (const lot of input.lots) {
    const q = Number(lot.quantityReceived);
    if (!(q > 0)) {
      throw new ValidationFailedError("quantityReceived must be > 0");
    }
  }

  return db.transaction(async (tx) => {
    const [poLine] = await tx
      .select()
      .from(schema.purchaseOrderLines)
      .where(eq(schema.purchaseOrderLines.id, input.poLineId));
    if (!poLine) throw new NotFoundError("po_line", input.poLineId);

    const insertedLots: schema.MaterialLot[] = [];
    let totalReceived = 0;
    for (const lot of input.lots) {
      const [created] = await tx
        .insert(schema.materialLots)
        .values({
          materialVariantId: poLine.materialVariantId,
          lotCode: lot.lotCode,
          dyeLot: lot.dyeLot ?? null,
          rollNumber: lot.rollNumber ?? null,
          countryOfOrigin: lot.countryOfOrigin ?? null,
          quantityReceived: lot.quantityReceived,
          quantityRemaining: lot.quantityReceived,
          receivedByUserId: input.actorUserId,
          poLineId: input.poLineId,
          certData: lot.certData ?? null,
          qualityStatus: lot.qualityStatus ?? "pending_qc",
          defectsNotes: lot.defectsNotes ?? null,
        })
        .returning();
      if (!created) throw new InternalError("material_lot insert returned no row");
      insertedLots.push(created);
      totalReceived += Number(lot.quantityReceived);

      await tx.insert(schema.lotMovements).values({
        lotId: created.id,
        movementType: "receipt",
        quantity: lot.quantityReceived,
        referenceType: "po_line",
        referenceId: input.poLineId,
        actorUserId: input.actorUserId,
      });

      await recordAudit({
        db: tx,
        entityType: "material_lot",
        entityId: created.id,
        action: "create",
        actorUserId: input.actorUserId,
        after: created,
      });
    }

    if (totalReceived > Number(poLine.quantityOrdered)) {
      await recordAudit({
        db: tx,
        entityType: "po_line",
        entityId: input.poLineId,
        action: "warning:over_received",
        actorUserId: input.actorUserId,
        after: { totalReceived, ordered: poLine.quantityOrdered },
      });
    }

    const newPoStatus = await recalculatePoStatus(tx, poLine.poId);
    return { poId: poLine.poId, lots: insertedLots, newPoStatus };
  });
}

export interface ReceiveOffPoInput {
  materialVariantId: number;
  lot: ReceiveLotDraft;
  actorUserId?: number;
}

export async function receiveOffPo(
  db: Database,
  input: ReceiveOffPoInput,
): Promise<schema.MaterialLot> {
  if (!(Number(input.lot.quantityReceived) > 0)) {
    throw new ValidationFailedError("quantityReceived must be > 0");
  }
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.materialLots)
      .values({
        materialVariantId: input.materialVariantId,
        lotCode: input.lot.lotCode,
        dyeLot: input.lot.dyeLot ?? null,
        rollNumber: input.lot.rollNumber ?? null,
        countryOfOrigin: input.lot.countryOfOrigin ?? null,
        quantityReceived: input.lot.quantityReceived,
        quantityRemaining: input.lot.quantityReceived,
        receivedByUserId: input.actorUserId,
        poLineId: null,
        certData: input.lot.certData ?? null,
        qualityStatus: input.lot.qualityStatus ?? "pending_qc",
        defectsNotes: input.lot.defectsNotes ?? null,
      })
      .returning();
    if (!created) throw new InternalError("material_lot insert returned no row");

    await tx.insert(schema.lotMovements).values({
      lotId: created.id,
      movementType: "receipt",
      quantity: input.lot.quantityReceived,
      referenceType: "manual",
      actorUserId: input.actorUserId,
    });

    await recordAudit({
      db: tx,
      entityType: "material_lot",
      entityId: created.id,
      action: "create_off_po",
      actorUserId: input.actorUserId,
      after: created,
    });

    return created;
  });
}

export async function updateLotQuality(
  db: Database,
  lotId: number,
  status: schema.QualityStatus,
  actorUserId?: number,
): Promise<schema.MaterialLot> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.materialLots)
      .where(eq(schema.materialLots.id, lotId));
    if (!before) throw new NotFoundError("material_lot", lotId);
    if (before.qualityStatus === "rejected" && status !== "rejected") {
      throw new BusinessRuleError("invalid_transition", "rejected lots cannot be unrejected");
    }
    const [after] = await tx
      .update(schema.materialLots)
      .set({ qualityStatus: status, updatedAt: new Date() })
      .where(eq(schema.materialLots.id, lotId))
      .returning();
    if (!after) throw new NotFoundError("material_lot", lotId);

    await recordAudit({
      db: tx,
      entityType: "material_lot",
      entityId: lotId,
      action: `state_transition:${before.qualityStatus}->${status}`,
      actorUserId,
      before,
      after,
    });
    return after;
  });
}

export interface LotProvenance {
  lot: schema.MaterialLot;
  variant: schema.MaterialVariant | null;
  material: schema.Material | null;
  poLine: schema.PurchaseOrderLine | null;
  po: schema.PurchaseOrder | null;
  vendor: schema.Vendor | null;
  movements: schema.LotMovement[];
}

export async function getLotProvenance(db: Database, lotId: number): Promise<LotProvenance> {
  const [lot] = await db
    .select()
    .from(schema.materialLots)
    .where(eq(schema.materialLots.id, lotId));
  if (!lot) throw new NotFoundError("material_lot", lotId);

  const [variant] = await db
    .select()
    .from(schema.materialVariants)
    .where(eq(schema.materialVariants.id, lot.materialVariantId));

  const material = variant
    ? ((
        await db.select().from(schema.materials).where(eq(schema.materials.id, variant.materialId))
      )[0] ?? null)
    : null;

  let poLine: schema.PurchaseOrderLine | null = null;
  let po: schema.PurchaseOrder | null = null;
  let vendor: schema.Vendor | null = null;

  if (lot.poLineId) {
    const [line] = await db
      .select()
      .from(schema.purchaseOrderLines)
      .where(eq(schema.purchaseOrderLines.id, lot.poLineId));
    poLine = line ?? null;
    if (poLine) {
      const [poRow] = await db
        .select()
        .from(schema.purchaseOrders)
        .where(eq(schema.purchaseOrders.id, poLine.poId));
      po = poRow ?? null;
      if (po) {
        const [vendorRow] = await db
          .select()
          .from(schema.vendors)
          .where(eq(schema.vendors.id, po.vendorId));
        vendor = vendorRow ?? null;
      }
    }
  }

  const movements = await db
    .select()
    .from(schema.lotMovements)
    .where(eq(schema.lotMovements.lotId, lotId));

  return {
    lot,
    variant: variant ?? null,
    material,
    poLine,
    po,
    vendor,
    movements,
  };
}

export async function listLotsByVariant(
  db: Database,
  materialVariantId: number,
): Promise<schema.MaterialLot[]> {
  return db
    .select()
    .from(schema.materialLots)
    .where(eq(schema.materialLots.materialVariantId, materialVariantId));
}
