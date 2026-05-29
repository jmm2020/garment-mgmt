import { schema } from "@garment-mgmt/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  completeBatch,
  receiveFromCutter,
  stageForProduction,
  startProduction,
  submitForQc,
} from "../src/services/production-batch-service.js";
import {
  assignFifoBatches,
  findBatchesByOrder,
  processOrderWebhook,
  type ShopifyOrderPayload,
} from "../src/services/shopify-webhook-service.js";
import {
  seedProductionFixture,
  seedValidatedPvt,
  type ProductionFixture,
} from "./helpers/seed-production.js";
import { closeTestDb, withTestDb } from "./helpers/test-db.js";
import type { Database } from "@garment-mgmt/db";

afterAll(async () => {
  await closeTestDb();
});

async function makeCompletedBatch(
  db: Database,
  fx: ProductionFixture,
  qty: string,
): Promise<schema.ProductionBatch> {
  const batch = await receiveFromCutter(db, {
    cutTicketId: fx.productionCutTicketId,
    productVariantId: fx.variantId,
    qtyPlanned: qty,
    cutterUserId: fx.userId,
    actorUserId: fx.userId,
  });
  await stageForProduction(db, batch.id, fx.userId);
  await startProduction(db, batch.id, fx.userId);
  await submitForQc(db, { ref: batch.id, qty, actorUserId: fx.userId });
  return completeBatch(db, { ref: batch.id, qty, verdict: "pass", actorUserId: fx.userId });
}

function makePayload(orderId: string, lineItemId: string, sku: string, quantity: number) {
  return {
    id: orderId,
    line_items: [{ id: lineItemId, sku, quantity }],
  } satisfies ShopifyOrderPayload;
}

describe("processOrderWebhook — FIFO mapping", () => {
  it("attributes a completed batch to an order line", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const completed = await makeCompletedBatch(db, fx, "10");

      await processOrderWebhook(db, makePayload("ORDER-1", "LINE-1", fx.variantSku, 5));

      const rows = await findBatchesByOrder(db, "ORDER-1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.batchNo).toBe(completed.batchNo);
      expect(rows[0]?.qty).toBe("5.000");
      expect(rows[0]?.cutTicketId).toBe(fx.productionCutTicketId);
      expect(rows[0]?.fabricLotIds).toEqual([]);
      const auditRows = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, "shopify.order.line.assigned"));
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.entityType).toBe("shopify_order_line_batch");
    });
  });

  it("splits a line item across multiple batches when one is short", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const first = await makeCompletedBatch(db, fx, "3");
      // Touch completed_at so FIFO ordering is deterministic across both batches.
      await db
        .update(schema.productionBatches)
        .set({ completedAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.productionBatches.id, first.id));
      const second = await makeCompletedBatch(db, fx, "10");

      await processOrderWebhook(db, makePayload("ORDER-2", "LINE-2", fx.variantSku, 8));

      const rows = await findBatchesByOrder(db, "ORDER-2");
      expect(rows).toHaveLength(2);
      const byBatchNo = new Map(rows.map((r) => [r.batchNo, r.qty]));
      expect(byBatchNo.get(first.batchNo)).toBe("3.000");
      expect(byBatchNo.get(second.batchNo)).toBe("5.000");
    });
  });

  it("is idempotent — replaying the same order is a no-op", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      await makeCompletedBatch(db, fx, "10");

      const payload = makePayload("ORDER-3", "LINE-3", fx.variantSku, 4);
      await processOrderWebhook(db, payload);
      await processOrderWebhook(db, payload);

      const rows = await findBatchesByOrder(db, "ORDER-3");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.qty).toBe("4.000");
    });
  });

  it("skips line items whose SKU is unknown to the Hub", async () => {
    await withTestDb(async (db) => {
      await expect(
        processOrderWebhook(db, makePayload("ORDER-4", "LINE-4", "NOT-A-HUB-SKU", 1)),
      ).resolves.toBeUndefined();
      const rows = await findBatchesByOrder(db, "ORDER-4");
      expect(rows).toHaveLength(0);
    });
  });

  it("skips line items with null sku", async () => {
    await withTestDb(async (db) => {
      const payload: ShopifyOrderPayload = {
        id: "ORDER-5",
        line_items: [{ id: "LINE-5", sku: null, quantity: 2 }],
      };
      await expect(processOrderWebhook(db, payload)).resolves.toBeUndefined();
      expect(await findBatchesByOrder(db, "ORDER-5")).toHaveLength(0);
    });
  });

  it("returns no rows when no completed batches exist for the SKU", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      // Receive but do NOT complete — no eligible inventory.
      await receiveFromCutter(db, {
        cutTicketId: fx.productionCutTicketId,
        productVariantId: fx.variantId,
        qtyPlanned: "10",
        cutterUserId: fx.userId,
      });
      await processOrderWebhook(db, makePayload("ORDER-6", "LINE-6", fx.variantSku, 5));
      expect(await findBatchesByOrder(db, "ORDER-6")).toHaveLength(0);
    });
  });

  it("second independent order takes only the remaining capacity from a partially consumed batch", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      const batch = await makeCompletedBatch(db, fx, "10");

      await processOrderWebhook(db, makePayload("ORDER-A", "LINE-A", fx.variantSku, 7));
      await processOrderWebhook(db, makePayload("ORDER-B", "LINE-B", fx.variantSku, 5));

      const rowsB = await findBatchesByOrder(db, "ORDER-B");
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0]?.batchNo).toBe(batch.batchNo);
      expect(rowsB[0]?.qty).toBe("3.000");
    });
  });

  it("skips a fully exhausted batch for a subsequent order", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      await makeCompletedBatch(db, fx, "4");

      await processOrderWebhook(db, makePayload("ORDER-X", "LINE-X", fx.variantSku, 4));
      await processOrderWebhook(db, makePayload("ORDER-Y", "LINE-Y", fx.variantSku, 1));

      expect(await findBatchesByOrder(db, "ORDER-Y")).toHaveLength(0);
    });
  });

  it("processes only hub-known SKUs when an order has mixed-SKU line items", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);
      await makeCompletedBatch(db, fx, "10");

      const payload: ShopifyOrderPayload = {
        id: "ORDER-MULTI",
        line_items: [
          { id: "LINE-KNOWN", sku: fx.variantSku, quantity: 3 },
          { id: "LINE-UNKNOWN", sku: "EXTERNAL-DROPSHIP-SKU", quantity: 2 },
        ],
      };
      await processOrderWebhook(db, payload);

      const rows = await findBatchesByOrder(db, "ORDER-MULTI");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.lineItemId).toBe("LINE-KNOWN");
      expect(rows[0]?.qty).toBe("3.000");
    });
  });

  it("includes fabric lot IDs in the forensic row when cut_ticket_lots exist", async () => {
    await withTestDb(async (db) => {
      const fx = await seedProductionFixture(db);
      await seedValidatedPvt(db, fx);

      // Seed: vendor → material → material_variant → material_lot → bom_component → cut_ticket_lot
      const tag = `fabric-${Date.now()}`;
      const [vendor] = await db
        .insert(schema.vendors)
        .values({ code: `V-${tag}`, name: `Vendor ${tag}`, vendorType: "mill" })
        .returning();
      if (!vendor) throw new Error("vendor insert failed");

      const [material] = await db
        .insert(schema.materials)
        .values({
          sku: `MAT-${tag}`,
          name: `Material ${tag}`,
          materialType: "fabric_shell",
          unitOfMeasure: "yard",
        })
        .returning();
      if (!material) throw new Error("material insert failed");

      const [matVariant] = await db
        .insert(schema.materialVariants)
        .values({ materialId: material.id, variantSku: `MV-${tag}` })
        .returning();
      if (!matVariant) throw new Error("materialVariant insert failed");

      const [matLot] = await db
        .insert(schema.materialLots)
        .values({
          materialVariantId: matVariant.id,
          lotCode: `LOT-${tag}`,
          quantityReceived: "20.000",
          quantityRemaining: "20.000",
        })
        .returning();
      if (!matLot) throw new Error("materialLot insert failed");

      const [bomComp] = await db
        .insert(schema.bomComponents)
        .values({
          bomId: fx.bomId,
          materialVariantId: matVariant.id,
          quantityPerUnit: "1.5000",
          unitOfMeasure: "yard",
        })
        .returning();
      if (!bomComp) throw new Error("bomComponent insert failed");

      await db.insert(schema.cutTicketLots).values({
        cutTicketId: fx.productionCutTicketId,
        materialLotId: matLot.id,
        bomComponentId: bomComp.id,
        plannedQuantity: "15.000",
      });

      await makeCompletedBatch(db, fx, "10");
      await processOrderWebhook(db, makePayload("ORDER-LOTS", "LINE-LOTS", fx.variantSku, 3));

      const rows = await findBatchesByOrder(db, "ORDER-LOTS");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.fabricLotIds).toContain(matLot.id);
    });
  });

  it("assignFifoBatches returns empty for non-positive qty", async () => {
    await withTestDb(async (db) => {
      const result = await assignFifoBatches(db, 999, 0);
      expect(result).toEqual([]);
    });
  });
});
