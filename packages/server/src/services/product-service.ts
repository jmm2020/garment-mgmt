import { schema, type Database } from "@garment-mgmt/db";
import { eq } from "drizzle-orm";
import { NotFoundError } from "../errors.js";
import { recordAudit } from "./audit-service.js";

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
    if (!product) throw new Error("product insert returned no row");
    await recordAudit({
      db: tx,
      entityType: "product",
      entityId: product.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: product,
    });
    return product;
  });
}

export interface AddProductVariantInput {
  productId: number;
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
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, input.productId));
    if (!product) throw new NotFoundError("product", input.productId);
    const [variant] = await tx
      .insert(schema.productVariants)
      .values({
        productId: input.productId,
        size: input.size,
        colorway: input.colorway,
        fgSku: input.fgSku,
        upc: input.upc ?? null,
      })
      .returning();
    if (!variant) throw new Error("product variant insert returned no row");
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

export async function listProducts(db: Database): Promise<schema.Product[]> {
  return db.select().from(schema.products);
}

export async function getProduct(db: Database, id: number): Promise<schema.Product> {
  const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id));
  if (!product) throw new NotFoundError("product", id);
  return product;
}
