import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "./client.js";
import * as schema from "./schema/index.js";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const db = getDb();
  console.log("[seed] start");

  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: schema.users.id }).from(schema.users).limit(1);
    if (existing.length > 0) {
      console.log("[seed] data already present — skipping");
      return;
    }

    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "dev";
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const [admin] = await tx
      .insert(schema.users)
      .values({
        email: adminEmail,
        name: "Demo Admin",
        passwordHash,
        role: "admin",
      })
      .returning();
    if (!admin) throw new Error("admin insert failed");

    const vendors = await tx
      .insert(schema.vendors)
      .values([
        {
          code: "MILL-MALDEN",
          name: "Malden Mills",
          vendorType: "mill",
          country: "US",
          certifications: { bluesign: true, pfas_free: true },
        },
        {
          code: "TRIM-YKK",
          name: "YKK",
          vendorType: "trim_supplier",
          country: "JP",
          certifications: { oeko_tex_100: true },
        },
        {
          code: "INS-PRIMALOFT",
          name: "PrimaLoft",
          vendorType: "trim_supplier",
          country: "US",
          certifications: { recycled_content_pct: 50 },
        },
      ])
      .returning();
    const [malden, ykk, primaloft] = vendors;
    if (!malden || !ykk || !primaloft) throw new Error("vendor seed failed");

    const materials = await tx
      .insert(schema.materials)
      .values([
        {
          sku: "FAB-RIPSTOP-200D",
          name: "200D Ripstop Nylon",
          materialType: "fabric_shell",
          unitOfMeasure: "yard",
          composition: { nylon: 100 },
          preferredVendorId: malden.id,
          reorderPoint: "500",
          targetStock: "2000",
        },
        {
          sku: "INS-600FILL",
          name: "600-Fill PrimaLoft Gold",
          materialType: "fabric_insulation",
          unitOfMeasure: "yard",
          preferredVendorId: primaloft.id,
        },
        {
          sku: "ZIP-YKK-5",
          name: "#5 YKK Coil Zipper",
          materialType: "zipper",
          unitOfMeasure: "each",
          preferredVendorId: ykk.id,
        },
        {
          sku: "SNAP-15MM",
          name: "15mm Antique Brass Snap",
          materialType: "snap",
          unitOfMeasure: "each",
          preferredVendorId: ykk.id,
        },
        {
          sku: "LBL-WOVEN",
          name: "Woven Brand Label",
          materialType: "label",
          unitOfMeasure: "each",
          preferredVendorId: ykk.id,
        },
      ])
      .returning();
    const [ripstop, insulation, zipper, snap, label] = materials;
    if (!ripstop || !insulation || !zipper || !snap || !label) {
      throw new Error("material seed failed");
    }

    const variants = await tx
      .insert(schema.materialVariants)
      .values([
        { materialId: ripstop.id, variantSku: "FAB-RIPSTOP-200D-SPRUCE", colorway: "Spruce Green" },
        { materialId: ripstop.id, variantSku: "FAB-RIPSTOP-200D-MIDNIGHT", colorway: "Midnight" },
        { materialId: ripstop.id, variantSku: "FAB-RIPSTOP-200D-RUST", colorway: "Rust" },
        { materialId: insulation.id, variantSku: "INS-600FILL-NATURAL", colorway: "Natural" },
        {
          materialId: zipper.id,
          variantSku: "ZIP-YKK-5-BLACK-24IN",
          colorway: "Black",
          sizeSpec: "#5 / 24in",
        },
        { materialId: snap.id, variantSku: "SNAP-15MM-AB", colorway: "Antique Brass" },
        { materialId: label.id, variantSku: "LBL-WOVEN-STD", colorway: "Black/White" },
      ])
      .returning();

    const ripstopSpruce = variants.find((v) => v.variantSku === "FAB-RIPSTOP-200D-SPRUCE")!;
    const insulationNatural = variants.find((v) => v.variantSku === "INS-600FILL-NATURAL")!;
    const zipperBlack = variants.find((v) => v.variantSku === "ZIP-YKK-5-BLACK-24IN")!;

    const [product] = await tx
      .insert(schema.products)
      .values({
        styleCode: "VEST-ADV-001",
        name: "Adventure Vest",
        season: "FW26",
        status: "approved",
        baseSamMinutes: "42.5",
      })
      .returning();
    if (!product) throw new Error("product seed failed");

    await tx.insert(schema.productVariants).values([
      { productId: product.id, size: "S", colorway: "Spruce Green", fgSku: "VEST-ADV-001-SPR-S" },
      { productId: product.id, size: "M", colorway: "Spruce Green", fgSku: "VEST-ADV-001-SPR-M" },
      { productId: product.id, size: "L", colorway: "Spruce Green", fgSku: "VEST-ADV-001-SPR-L" },
    ]);

    const [bom] = await tx
      .insert(schema.boms)
      .values({
        productId: product.id,
        version: 1,
        status: "active",
        approvedByUserId: admin.id,
        approvedAt: new Date(),
        effectiveDate: new Date().toISOString().slice(0, 10),
      })
      .returning();
    if (!bom) throw new Error("bom seed failed");

    await tx.insert(schema.bomComponents).values([
      {
        bomId: bom.id,
        materialVariantId: ripstopSpruce.id,
        quantityPerUnit: "2.5",
        unitOfMeasure: "yard",
        position: "shell_front",
        isVisiblePanel: true,
        sizeCurve: { S: 0.96, M: 1.0, L: 1.05 },
        wasteFactorPct: "8.00",
      },
      {
        bomId: bom.id,
        materialVariantId: insulationNatural.id,
        quantityPerUnit: "1.8",
        unitOfMeasure: "yard",
        position: "lining",
        isVisiblePanel: false,
        sizeCurve: { S: 0.96, M: 1.0, L: 1.05 },
        wasteFactorPct: "6.00",
      },
      {
        bomId: bom.id,
        materialVariantId: zipperBlack.id,
        quantityPerUnit: "1",
        unitOfMeasure: "each",
        position: "trim_zipper_front",
        isVisiblePanel: false,
        wasteFactorPct: "0.00",
      },
    ]);

    await tx.insert(schema.markers).values({
      code: "MARKER-VEST-ADV-001-SML",
      productId: product.id,
      sizeRange: "S-M-L",
      widthInches: "58.00",
      lengthInches: "180.00",
      efficiencyPct: "82.50",
      fabricRequiredPerUnit: "2.6500",
    });

    const [po] = await tx
      .insert(schema.purchaseOrders)
      .values({
        poNumber: "PO-DEMO-0001",
        vendorId: malden.id,
        status: "confirmed",
        currency: "USD",
        orderedAt: new Date(),
      })
      .returning();
    if (!po) throw new Error("po seed failed");

    const [poLine] = await tx
      .insert(schema.purchaseOrderLines)
      .values({
        poId: po.id,
        materialVariantId: ripstopSpruce.id,
        quantityOrdered: "500",
        unitCost: "8.7500",
      })
      .returning();
    if (!poLine) throw new Error("po line seed failed");

    const lots = await tx
      .insert(schema.materialLots)
      .values([
        {
          materialVariantId: ripstopSpruce.id,
          lotCode: "MM-RIP-2026-001",
          dyeLot: "DL-AURORA-001",
          rollNumber: "R-1001",
          countryOfOrigin: "US",
          quantityReceived: "300",
          quantityRemaining: "300",
          poLineId: poLine.id,
          receivedByUserId: admin.id,
          qualityStatus: "passed",
          certData: {
            bluesign_cert_id: "BS-2026-7788",
            test_report_urls: ["https://example.test/coa-7788"],
          },
        },
        {
          materialVariantId: ripstopSpruce.id,
          lotCode: "MM-RIP-2026-002",
          dyeLot: "DL-AURORA-002",
          rollNumber: "R-1002",
          countryOfOrigin: "US",
          quantityReceived: "200",
          quantityRemaining: "200",
          poLineId: poLine.id,
          receivedByUserId: admin.id,
          qualityStatus: "passed",
        },
      ])
      .returning();

    for (const lot of lots) {
      await tx.insert(schema.lotMovements).values({
        lotId: lot.id,
        movementType: "receipt",
        quantity: lot.quantityReceived,
        referenceType: "po_line",
        referenceId: poLine.id,
        actorUserId: admin.id,
      });
    }

    await tx
      .update(schema.purchaseOrders)
      .set({ status: "received" })
      .where(eq(schema.purchaseOrders.id, po.id));

    console.log(
      `[seed] inserted admin=${admin.id} product=${product.id} po=${po.id} lots=${lots.length}`,
    );
  });

  console.log("[seed] done");
  await closeDb();
}

main().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});
