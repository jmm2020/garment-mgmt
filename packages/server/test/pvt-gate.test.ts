import { schema } from "@garment-mgmt/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { receiveFromCutter } from "../src/services/production-batch-service.js";
import { withTestDb } from "./helpers/test-db.js";
import { seedProductionFixture } from "./helpers/seed-production.js";

describe("PVT gate", () => {
  it("blocks receiveFromCutter when no PVT has been validated for (variant, marker)", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await expect(
        receiveFromCutter(db, {
          cutTicketId: fx.productionCutTicketId,
          productVariantId: fx.variantId,
          qtyPlanned: "5",
          cutterUserId: fx.userId,
        }),
      ).rejects.toMatchObject({ code: "rule.pvt_required" });
    });
  });

  it("allows force=true to bypass the gate and writes an override audit row", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      const batch = await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "5",
        cutterUserId: fx.userId,
        actorUserId: fx.userId,
        force: true,
      });
      expect(batch.status).toBe("received_from_cutter");

      const overrides = await db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.entityType, "production_batch"),
            eq(schema.auditLog.entityId, batch.id),
            eq(schema.auditLog.action, "pvt_gate_override"),
          ),
        );
      expect(overrides.length).toBe(1);
    });
  });
});

describe("product_variants — sku uniqueness", () => {
  it("rejects a second variant with the same canonical sku", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db, {
        variantSku: "PERF-HOOD-BLK-M-MENS-FW26-12OZ-COTTON-UNIQUE-TEST",
      });
      await expect(
        db.insert(schema.productVariants).values({
          productId: fx.productId,
          size: "L",
          colorway: "Other",
          fgSku: `FG-DUPLICATE-${Date.now()}`,
          sku: fx.variantSku,
          line: "PERF",
          model: "HOOD",
          color: "BLK",
          sizeDim: "L",
          gender: "MENS",
          seasonDim: "FW26",
          fabricType: "12OZ-COTTON",
        }),
      ).rejects.toThrow(/unique|duplicate/i);
    });
  });
});
