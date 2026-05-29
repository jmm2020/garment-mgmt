import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { and, desc, eq, max } from "drizzle-orm";
import { BusinessRuleError, InternalError, NotFoundError } from "../errors.js";
import { recordAudit } from "./audit-service.js";

type Bom = schema.Bom;
type BomComponent = schema.BomComponent;

export interface ComponentDraft {
  materialVariantId: number;
  quantityPerUnit: string;
  unitOfMeasure: schema.UnitOfMeasure;
  position?: string | null;
  isVisiblePanel?: boolean;
  sizeCurve?: Record<string, number> | null;
  wasteFactorPct?: string;
  isOptional?: boolean;
  notes?: string | null;
}

export interface CreateBomInput {
  productId: number;
  components: ComponentDraft[];
  notes?: string | null;
  actorUserId?: number;
}

export async function createBom(
  db: Database,
  input: CreateBomInput,
): Promise<Bom & { components: BomComponent[] }> {
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, input.productId));
    if (!product) throw new NotFoundError("product", input.productId);

    const maxResult = await tx
      .select({ maxVersion: max(schema.boms.version) })
      .from(schema.boms)
      .where(eq(schema.boms.productId, input.productId));

    const nextVersion = (maxResult[0]?.maxVersion ?? 0) + 1;

    const [bom] = await tx
      .insert(schema.boms)
      .values({
        productId: input.productId,
        version: nextVersion,
        status: "draft",
        notes: input.notes ?? null,
      })
      .returning();
    if (!bom) throw new InternalError("bom insert returned no row");

    const components =
      input.components.length === 0
        ? []
        : await tx
            .insert(schema.bomComponents)
            .values(
              input.components.map((c) => ({
                bomId: bom.id,
                materialVariantId: c.materialVariantId,
                quantityPerUnit: c.quantityPerUnit,
                unitOfMeasure: c.unitOfMeasure,
                position: c.position ?? null,
                isVisiblePanel: c.isVisiblePanel ?? false,
                sizeCurve: c.sizeCurve ?? null,
                wasteFactorPct: c.wasteFactorPct ?? "8.00",
                isOptional: c.isOptional ?? false,
                notes: c.notes ?? null,
              })),
            )
            .returning();

    await recordAudit({
      db: tx,
      entityType: "bom",
      entityId: bom.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: { bom, components },
    });

    return { ...bom, components };
  });
}

async function loadBom(db: DbExecutor, id: number): Promise<Bom> {
  const [bom] = await db.select().from(schema.boms).where(eq(schema.boms.id, id));
  if (!bom) throw new NotFoundError("bom", id);
  return bom;
}

export async function addComponent(
  db: Database,
  bomId: number,
  draft: ComponentDraft,
  actorUserId?: number,
): Promise<BomComponent> {
  return db.transaction(async (tx) => {
    const bom = await loadBom(tx, bomId);
    if (bom.status !== "draft") {
      throw new BusinessRuleError("bom_locked", "Components only editable while status=draft");
    }
    const [component] = await tx
      .insert(schema.bomComponents)
      .values({
        bomId,
        materialVariantId: draft.materialVariantId,
        quantityPerUnit: draft.quantityPerUnit,
        unitOfMeasure: draft.unitOfMeasure,
        position: draft.position ?? null,
        isVisiblePanel: draft.isVisiblePanel ?? false,
        sizeCurve: draft.sizeCurve ?? null,
        wasteFactorPct: draft.wasteFactorPct ?? "8.00",
        isOptional: draft.isOptional ?? false,
        notes: draft.notes ?? null,
      })
      .returning();
    if (!component)
      throw new InternalError("bom_component insert returned no row");
    await recordAudit({
      db: tx,
      entityType: "bom_component",
      entityId: component.id,
      action: "create",
      actorUserId,
      after: component,
    });
    return component;
  });
}

export async function removeComponent(
  db: Database,
  componentId: number,
  actorUserId?: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [component] = await tx
      .select()
      .from(schema.bomComponents)
      .where(eq(schema.bomComponents.id, componentId));
    if (!component) throw new NotFoundError("bom_component", componentId);
    const bom = await loadBom(tx, component.bomId);
    if (bom.status !== "draft") {
      throw new BusinessRuleError("bom_locked", "Components only editable while status=draft");
    }
    await tx.delete(schema.bomComponents).where(eq(schema.bomComponents.id, componentId));
    await recordAudit({
      db: tx,
      entityType: "bom_component",
      entityId: componentId,
      action: "delete",
      actorUserId,
      before: component,
    });
  });
}

export async function approveBom(db: Database, bomId: number, userId: number): Promise<Bom> {
  return db.transaction(async (tx) => {
    const before = await loadBom(tx, bomId);
    if (before.status !== "draft") {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot approve BOM in status=${before.status}`,
      );
    }
    const [after] = await tx
      .update(schema.boms)
      .set({
        status: "approved",
        approvedByUserId: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.boms.id, bomId))
      .returning();
    if (!after) throw new NotFoundError("bom", bomId);

    await recordAudit({
      db: tx,
      entityType: "bom",
      entityId: bomId,
      action: "state_transition:draft->approved",
      actorUserId: userId,
      before,
      after,
    });
    return after;
  });
}

export async function activateBom(db: Database, bomId: number, userId: number): Promise<Bom> {
  return db.transaction(async (tx) => {
    const before = await loadBom(tx, bomId);
    if (before.status !== "approved") {
      throw new BusinessRuleError(
        "invalid_transition",
        `Cannot activate BOM in status=${before.status}`,
      );
    }

    const previouslyActive = await tx
      .select()
      .from(schema.boms)
      .where(and(eq(schema.boms.productId, before.productId), eq(schema.boms.status, "active")));

    for (const prior of previouslyActive) {
      await tx
        .update(schema.boms)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(eq(schema.boms.id, prior.id));
      await recordAudit({
        db: tx,
        entityType: "bom",
        entityId: prior.id,
        action: "state_transition:active->superseded",
        actorUserId: userId,
        before: prior,
      });
    }

    const [after] = await tx
      .update(schema.boms)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(schema.boms.id, bomId))
      .returning();
    if (!after) throw new NotFoundError("bom", bomId);

    await recordAudit({
      db: tx,
      entityType: "bom",
      entityId: bomId,
      action: "state_transition:approved->active",
      actorUserId: userId,
      before,
      after,
    });

    return after;
  });
}

export async function getBom(
  db: Database,
  bomId: number,
): Promise<Bom & { components: BomComponent[] }> {
  const bom = await loadBom(db, bomId);
  const components = await db
    .select()
    .from(schema.bomComponents)
    .where(eq(schema.bomComponents.bomId, bomId));
  return { ...bom, components };
}

export async function listBomsForProduct(db: Database, productId: number): Promise<Bom[]> {
  return db
    .select()
    .from(schema.boms)
    .where(eq(schema.boms.productId, productId))
    .orderBy(desc(schema.boms.version));
}

export interface CutTicketComponentRequirement {
  materialVariantId: number;
  totalQuantity: number;
  unitOfMeasure: schema.UnitOfMeasure;
  isVisiblePanel: boolean;
  bomComponentId: number;
}

export function computeRequirementsFromComponents(
  components: BomComponent[],
  sizeBreakdown: Record<string, number>,
): CutTicketComponentRequirement[] {
  return components.map((c) => {
    const curve = (c.sizeCurve as Record<string, number> | null) ?? {};
    const baseQty = Number(c.quantityPerUnit);
    const waste = 1 + Number(c.wasteFactorPct) / 100;
    let totalUnits = 0;
    for (const [size, qty] of Object.entries(sizeBreakdown)) {
      const multiplier = curve[size] ?? 1;
      totalUnits += qty * multiplier;
    }
    return {
      materialVariantId: c.materialVariantId,
      totalQuantity: baseQty * totalUnits * waste,
      unitOfMeasure: c.unitOfMeasure,
      isVisiblePanel: c.isVisiblePanel,
      bomComponentId: c.id,
    };
  });
}

export async function componentsForCutTicket(
  db: DbExecutor,
  bomId: number,
  sizeBreakdown: Record<string, number>,
): Promise<CutTicketComponentRequirement[]> {
  const components = await db
    .select()
    .from(schema.bomComponents)
    .where(eq(schema.bomComponents.bomId, bomId));
  return computeRequirementsFromComponents(components, sizeBreakdown);
}
