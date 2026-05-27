import { schema, type Database } from "@garment-mgmt/db";

/**
 * Minimal fixture builder for production-batch + PVT integration tests.
 *
 * Inserts a user, product, variant, marker, BOM, and a 'production' cut ticket
 * (and optionally a 'pvt' cut ticket too) so the system-under-test has valid FK
 * targets. Returns the IDs the test will exercise.
 *
 * All work runs inside whatever transaction `withTestDb` is currently holding,
 * so seeded rows are rolled back at the end of each test — no cross-test bleed.
 */
export interface ProductionFixture {
  userId: number;
  productId: number;
  variantId: number;
  variantSku: string;
  markerId: number;
  bomId: number;
  productionCutTicketId: number;
  pvtCutTicketId: number;
}

export interface SeedOptions {
  variantSku?: string;
  variantSize?: string;
  variantColorway?: string;
  pvtValidityMonths?: number | null;
}

let counter = 0;
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

export async function seedProductionFixture(
  db: Database,
  opts: SeedOptions = {},
): Promise<ProductionFixture> {
  const tag = uniq();
  const variantSku = opts.variantSku ?? `PERF-HOOD-BLK-M-MENS-FW26-12OZ-COTTON-${tag}`;

  const [user] = await db
    .insert(schema.users)
    .values({
      email: `seed-${tag}@example.com`,
      name: "Seed User",
      passwordHash: "x",
      role: "production_staff",
    })
    .returning();
  if (!user) throw new Error("seed: user insert returned nothing");

  const [product] = await db
    .insert(schema.products)
    .values({
      styleCode: `STY-${tag}`,
      name: `Seed Product ${tag}`,
      status: "in_production",
      pvtValidityMonths: opts.pvtValidityMonths ?? null,
    })
    .returning();
  if (!product) throw new Error("seed: product insert returned nothing");

  const [variant] = await db
    .insert(schema.productVariants)
    .values({
      productId: product.id,
      size: opts.variantSize ?? "M",
      colorway: opts.variantColorway ?? "Black",
      fgSku: `FG-${tag}`,
      sku: variantSku,
      line: "PERF",
      model: "HOOD",
      color: "BLK",
      sizeDim: "M",
      gender: "MENS",
      seasonDim: "FW26",
      fabricType: "12OZ-COTTON",
    })
    .returning();
  if (!variant) throw new Error("seed: variant insert returned nothing");

  const [marker] = await db
    .insert(schema.markers)
    .values({
      code: `MK-${tag}`,
      productId: product.id,
      widthInches: "60.00",
      lengthInches: "120.00",
      efficiencyPct: "85.00",
    })
    .returning();
  if (!marker) throw new Error("seed: marker insert returned nothing");

  const [bom] = await db
    .insert(schema.boms)
    .values({
      productId: product.id,
      version: 1,
      status: "active",
    })
    .returning();
  if (!bom) throw new Error("seed: bom insert returned nothing");

  const [prodCt] = await db
    .insert(schema.cutTickets)
    .values({
      ticketNumber: `CT-PROD-${tag}`,
      productId: product.id,
      bomId: bom.id,
      markerId: marker.id,
      kind: "production",
      status: "allocated",
      plannedQuantityBySize: { M: 10 },
    })
    .returning();
  if (!prodCt) throw new Error("seed: production cut ticket insert returned nothing");

  const [pvtCt] = await db
    .insert(schema.cutTickets)
    .values({
      ticketNumber: `CT-PVT-${tag}`,
      productId: product.id,
      bomId: bom.id,
      markerId: marker.id,
      kind: "pvt",
      status: "allocated",
      plannedQuantityBySize: { M: 1 },
    })
    .returning();
  if (!pvtCt) throw new Error("seed: pvt cut ticket insert returned nothing");

  return {
    userId: user.id,
    productId: product.id,
    variantId: variant.id,
    variantSku,
    markerId: marker.id,
    bomId: bom.id,
    productionCutTicketId: prodCt.id,
    pvtCutTicketId: pvtCt.id,
  };
}

/**
 * Walks a PVT through the full happy path so callers can test scenarios that
 * require the gate to be open: createPvtRun → markPvtShipped → markPvtReceived →
 * validatePvt. Returns the validated run.
 */
export async function seedValidatedPvt(
  db: Database,
  fixture: ProductionFixture,
): Promise<schema.ProductionValidationRun> {
  const { createPvtRun, markPvtShipped, markPvtReceived, validatePvt } =
    await import("../../src/services/pvt-service.js");

  const run = await createPvtRun(db, {
    productVariantId: fixture.variantId,
    markerId: fixture.markerId,
    cutterUserId: fixture.userId,
    cutTicketId: fixture.pvtCutTicketId,
  });
  await markPvtShipped(db, run.id, fixture.userId);
  await markPvtReceived(db, run.id, fixture.userId);
  return validatePvt(db, {
    ref: run.id,
    validatorUserId: fixture.userId,
  });
}
