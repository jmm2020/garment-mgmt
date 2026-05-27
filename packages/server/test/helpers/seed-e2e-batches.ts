import { closeDb, getDb, schema } from "@garment-mgmt/db";

let counter = 0;
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const db = getDb();
  const tag = uniq();

  const ids = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        email: `seed-e2e-bat-${tag}@example.com`,
        name: "E2E Batch Seed User",
        passwordHash: "x",
        role: "production_staff",
      })
      .returning();
    if (!user) throw new Error("seed-e2e-batches: user insert returned nothing");

    const [product] = await tx
      .insert(schema.products)
      .values({
        styleCode: `E2E-BAT-${tag}`,
        name: `E2E Batch Product ${tag}`,
        status: "in_production",
      })
      .returning();
    if (!product) throw new Error("seed-e2e-batches: product insert returned nothing");

    const [variant] = await tx
      .insert(schema.productVariants)
      .values({
        productId: product.id,
        size: "M",
        colorway: "Black",
        fgSku: `FG-BAT-${tag}`,
        sku: `PERF-HOOD-BLK-M-MENS-FW26-12OZ-COTTON-${tag}`,
        line: "PERF",
        model: "HOOD",
        color: "BLK",
        sizeDim: "M",
        gender: "MENS",
        seasonDim: "FW26",
        fabricType: "12OZ-COTTON",
      })
      .returning();
    if (!variant) throw new Error("seed-e2e-batches: variant insert returned nothing");

    const [marker] = await tx
      .insert(schema.markers)
      .values({
        code: `MK-BAT-${tag}`,
        productId: product.id,
        widthInches: "60.00",
        lengthInches: "120.00",
        efficiencyPct: "85.00",
      })
      .returning();
    if (!marker) throw new Error("seed-e2e-batches: marker insert returned nothing");

    const [bom] = await tx
      .insert(schema.boms)
      .values({
        productId: product.id,
        version: 1,
        status: "active",
      })
      .returning();
    if (!bom) throw new Error("seed-e2e-batches: bom insert returned nothing");

    const [prodCt] = await tx
      .insert(schema.cutTickets)
      .values({
        ticketNumber: `CT-PROD-BAT-${tag}`,
        productId: product.id,
        bomId: bom.id,
        markerId: marker.id,
        kind: "production",
        status: "allocated",
        plannedQuantityBySize: { M: 10 },
      })
      .returning();
    if (!prodCt) {
      throw new Error("seed-e2e-batches: production cut ticket insert returned nothing");
    }

    const [pvtCt] = await tx
      .insert(schema.cutTickets)
      .values({
        ticketNumber: `CT-PVT-BAT-${tag}`,
        productId: product.id,
        bomId: bom.id,
        markerId: marker.id,
        kind: "pvt",
        status: "allocated",
        plannedQuantityBySize: { M: 1 },
      })
      .returning();
    if (!pvtCt) throw new Error("seed-e2e-batches: pvt cut ticket insert returned nothing");

    return {
      userId: user.id,
      productId: product.id,
      variantId: variant.id,
      markerId: marker.id,
      bomId: bom.id,
      productionCutTicketId: prodCt.id,
      pvtCutTicketId: pvtCt.id,
    };
  });

  process.stdout.write(`${JSON.stringify(ids)}\n`);
  await closeDb();
}

main().catch((err) => {
  console.error("[seed-e2e-batches] failed", err);
  process.exit(1);
});
