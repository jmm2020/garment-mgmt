import { schema, type Database } from "@garment-mgmt/db";
import { and, eq } from "drizzle-orm";
import { BusinessRuleError, NotFoundError } from "../errors.js";
import { recordAudit } from "./audit-service.js";

function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code;
}

function pgConstraint(err: unknown): string | undefined {
  return (err as { constraint_name?: string })?.constraint_name;
}

export interface CreateProductInput {
  styleCode: string;
  name: string;
  season?: string | null;
  baseSamMinutes?: string | null;
  targetCogsCents?: number | null;
  description?: string | null;
  actorUserId?: number;
}

export async function createProduct(
  db: Database,
  input: CreateProductInput,
): Promise<schema.Product> {
  return db.transaction(async (tx) => {
    const [product] = await tx
      .insert(schema.products)
      .values({
        styleCode: input.styleCode,
        name: input.name,
        season: input.season ?? null,
        baseSamMinutes: input.baseSamMinutes ?? null,
        targetCogsCents: input.targetCogsCents ?? null,
        description: input.description ?? null,
      })
      .returning();
    await recordAudit({
      db: tx,
      entityType: "product",
      entityId: product!.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: product!,
    });
    return product!;
  });
}

export interface AddProductVariantInput {
  productId: number;
  line: schema.Line;
  model: schema.Model;
  color: schema.Color;
  sizeDim: schema.SizeDim;
  gender: schema.Gender;
  seasonDim: string;
  fabricType: schema.FabricType;
  size: string;
  colorway: string;
  fgSku: string;
  upc?: string | null;
  actorUserId?: number;
}

export async function addProductVariant(
  db: Database,
  input: AddProductVariantInput,
): Promise<schema.ProductVariant> {
  const sku = schema.composeSku({
    line: input.line,
    model: input.model,
    color: input.color,
    size: input.sizeDim,
    gender: input.gender,
    season: input.seasonDim,
    fabricType: input.fabricType,
  });
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, input.productId));
    if (!product) throw new NotFoundError("product", input.productId);
    let variant: schema.ProductVariant;
    try {
      const [row] = await tx
        .insert(schema.productVariants)
        .values({
          productId: input.productId,
          size: input.size,
          colorway: input.colorway,
          fgSku: input.fgSku,
          upc: input.upc ?? null,
          line: input.line,
          model: input.model,
          color: input.color,
          sizeDim: input.sizeDim,
          gender: input.gender,
          seasonDim: input.seasonDim,
          fabricType: input.fabricType,
          sku,
        })
        .returning();
      variant = row!;
    } catch (err) {
      if (pgErrorCode(err) === "23505") {
        const constraint = pgConstraint(err);
        if (constraint === "product_variants_sku_idx") {
          throw new BusinessRuleError("sku_conflict", `SKU ${sku} already exists`, { sku });
        }
        if (constraint === "product_variants_unique_idx") {
          throw new BusinessRuleError(
            "size_colorway_conflict",
            "A variant with this size and colorway already exists for this product",
            { productId: input.productId, size: input.size, colorway: input.colorway },
          );
        }
        throw new BusinessRuleError("unique_conflict", "A conflicting variant already exists");
      }
      throw err;
    }
    await recordAudit({
      db: tx,
      entityType: "product_variant",
      entityId: variant.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: variant,
    });
    return variant;
  });
}

export interface UpdateProductVariantInput {
  productId: number;
  variantId: number;
  line: schema.Line;
  model: schema.Model;
  color: schema.Color;
  sizeDim: schema.SizeDim;
  gender: schema.Gender;
  seasonDim: string;
  fabricType: schema.FabricType;
  size: string;
  colorway: string;
  fgSku: string;
  upc?: string | null;
  actorUserId?: number;
}

export async function updateProductVariant(
  db: Database,
  input: UpdateProductVariantInput,
): Promise<schema.ProductVariant> {
  const sku = schema.composeSku({
    line: input.line,
    model: input.model,
    color: input.color,
    size: input.sizeDim,
    gender: input.gender,
    season: input.seasonDim,
    fabricType: input.fabricType,
  });
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.id, input.variantId),
          eq(schema.productVariants.productId, input.productId),
        ),
      );
    if (!existing) throw new NotFoundError("product_variant", input.variantId);
    let variant: schema.ProductVariant;
    try {
      const [row] = await tx
        .update(schema.productVariants)
        .set({
          line: input.line,
          model: input.model,
          color: input.color,
          sizeDim: input.sizeDim,
          gender: input.gender,
          seasonDim: input.seasonDim,
          fabricType: input.fabricType,
          sku,
          size: input.size,
          colorway: input.colorway,
          fgSku: input.fgSku,
          upc: input.upc ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.productVariants.id, input.variantId))
        .returning();
      variant = row!;
    } catch (err) {
      if (pgErrorCode(err) === "23505") {
        const constraint = pgConstraint(err);
        if (constraint === "product_variants_sku_idx") {
          throw new BusinessRuleError("sku_conflict", `SKU ${sku} already exists`, { sku });
        }
        if (constraint === "product_variants_unique_idx") {
          throw new BusinessRuleError(
            "size_colorway_conflict",
            "A variant with this size and colorway already exists for this product",
            { productId: input.productId, size: input.size, colorway: input.colorway },
          );
        }
        throw new BusinessRuleError("unique_conflict", "A conflicting variant already exists");
      }
      throw err;
    }
    await recordAudit({
      db: tx,
      entityType: "product_variant",
      entityId: variant.id,
      action: "update",
      actorUserId: input.actorUserId,
      before: existing,
      after: variant,
    });
    return variant;
  });
}

export async function listProducts(db: Database): Promise<schema.Product[]> {
  return db.select().from(schema.products);
}

export async function getProduct(db: Database, id: number): Promise<schema.Product> {
  const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id));
  if (!product) throw new NotFoundError("product", id);
  return product;
}
