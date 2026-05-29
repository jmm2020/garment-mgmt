import { schema, type Database } from "@garment-mgmt/db";
import { and, desc, eq, gt, or } from "drizzle-orm";
import { BusinessRuleError, InternalError, NotFoundError } from "../errors.js";
import { recordAudit } from "./audit-service.js";

export interface CreateMaterialInput {
  sku: string;
  name: string;
  materialType: (typeof schema.MATERIAL_TYPES)[number];
  unitOfMeasure: schema.UnitOfMeasure;
  composition?: unknown;
  preferredVendorId?: number | null;
  reorderPoint?: string | null;
  targetStock?: string | null;
  notes?: string | null;
  actorUserId?: number;
}

export async function createMaterial(
  db: Database,
  input: CreateMaterialInput,
): Promise<schema.Material> {
  return db.transaction(async (tx) => {
    const [material] = await tx
      .insert(schema.materials)
      .values({
        sku: input.sku,
        name: input.name,
        materialType: input.materialType,
        unitOfMeasure: input.unitOfMeasure,
        composition: input.composition ?? null,
        preferredVendorId: input.preferredVendorId ?? null,
        reorderPoint: input.reorderPoint ?? null,
        targetStock: input.targetStock ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    if (!material)
      throw new InternalError("material insert returned no row");
    await recordAudit({
      db: tx,
      entityType: "material",
      entityId: material.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: material,
    });
    return material;
  });
}

export interface AddVariantInput {
  materialId: number;
  variantSku: string;
  colorway?: string | null;
  sizeSpec?: string | null;
  actorUserId?: number;
}

export async function addVariant(
  db: Database,
  input: AddVariantInput,
): Promise<schema.MaterialVariant> {
  return db.transaction(async (tx) => {
    const [material] = await tx
      .select()
      .from(schema.materials)
      .where(eq(schema.materials.id, input.materialId));
    if (!material) throw new NotFoundError("material", input.materialId);

    const [variant] = await tx
      .insert(schema.materialVariants)
      .values({
        materialId: input.materialId,
        variantSku: input.variantSku,
        colorway: input.colorway ?? null,
        sizeSpec: input.sizeSpec ?? null,
      })
      .returning();
    if (!variant)
      throw new InternalError("material_variant insert returned no row");

    await recordAudit({
      db: tx,
      entityType: "material_variant",
      entityId: variant.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: variant,
    });
    return variant;
  });
}

export async function listMaterials(
  db: Database,
  opts: { limit?: number; cursor?: { createdAt: Date; id: number } | null } = {},
): Promise<{ items: schema.Material[]; nextCursor: { createdAt: Date; id: number } | null }> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const whereExpr = opts.cursor
    ? or(
        gt(schema.materials.createdAt, opts.cursor.createdAt),
        and(
          eq(schema.materials.createdAt, opts.cursor.createdAt),
          gt(schema.materials.id, opts.cursor.id),
        ),
      )
    : undefined;
  const rows = await db
    .select()
    .from(schema.materials)
    .where(whereExpr)
    .orderBy(desc(schema.materials.createdAt), desc(schema.materials.id))
    .limit(limit + 1);

  const items = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit && items.length > 0
      ? { createdAt: items[items.length - 1]!.createdAt, id: items[items.length - 1]!.id }
      : null;
  return { items, nextCursor };
}

export async function getMaterial(
  db: Database,
  id: number,
): Promise<schema.Material & { variants: schema.MaterialVariant[] }> {
  const [material] = await db.select().from(schema.materials).where(eq(schema.materials.id, id));
  if (!material) throw new NotFoundError("material", id);
  const variants = await db
    .select()
    .from(schema.materialVariants)
    .where(eq(schema.materialVariants.materialId, id));
  return { ...material, variants };
}

export async function updateMaterial(
  db: Database,
  id: number,
  input: Partial<Omit<CreateMaterialInput, "sku" | "actorUserId">> & { actorUserId?: number },
): Promise<schema.Material> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.materials).where(eq(schema.materials.id, id));
    if (!before) throw new NotFoundError("material", id);

    if (input.unitOfMeasure && input.unitOfMeasure !== before.unitOfMeasure) {
      // Changing UoM after variants exist is dangerous — block.
      const variants = await tx
        .select({ id: schema.materialVariants.id })
        .from(schema.materialVariants)
        .where(eq(schema.materialVariants.materialId, id));
      if (variants.length > 0) {
        throw new BusinessRuleError(
          "uom_change_blocked",
          "Cannot change unit_of_measure after variants exist",
        );
      }
    }

    const [after] = await tx
      .update(schema.materials)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.materialType !== undefined ? { materialType: input.materialType } : {}),
        ...(input.unitOfMeasure !== undefined ? { unitOfMeasure: input.unitOfMeasure } : {}),
        ...(input.composition !== undefined ? { composition: input.composition } : {}),
        ...(input.preferredVendorId !== undefined
          ? { preferredVendorId: input.preferredVendorId }
          : {}),
        ...(input.reorderPoint !== undefined ? { reorderPoint: input.reorderPoint } : {}),
        ...(input.targetStock !== undefined ? { targetStock: input.targetStock } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.materials.id, id))
      .returning();
    if (!after) throw new NotFoundError("material", id);

    await recordAudit({
      db: tx,
      entityType: "material",
      entityId: id,
      action: "update",
      actorUserId: input.actorUserId,
      before,
      after,
    });
    return after;
  });
}
