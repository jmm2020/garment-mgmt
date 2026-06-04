import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "./helpers/test-db.js";
import { syncPendingOnceLots, startInventorySyncLoop } from "../src/jobs/inventree-sync.js";
import type { InvenTreeClientConfig } from "../src/integrations/inventree-client.js";
import { schema } from "@garment-mgmt/db";

// seed helper — inserts the minimal rows needed for a material lot.
// The sync job joins materialLots -> materialVariants -> materials, so no vendor is needed.
async function seedLot(db: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const [mat] = await db
    .insert(schema.materials)
    .values({
      sku: "MAT-001",
      name: "Test Fabric",
      materialType: "fabric_shell",
      unitOfMeasure: "yard",
    })
    .returning();
  if (!mat) throw new Error("seed: material insert returned no row");
  const [variant] = await db
    .insert(schema.materialVariants)
    .values({
      materialId: mat.id,
      variantSku: "MAT-001-BLK",
    })
    .returning();
  if (!variant) throw new Error("seed: variant insert returned no row");
  const [lot] = await db
    .insert(schema.materialLots)
    .values({
      materialVariantId: variant.id,
      lotCode: "LOT-001",
      quantityReceived: "100.000",
      quantityRemaining: "100.000",
    })
    .returning();
  if (!lot) throw new Error("seed: lot insert returned no row");
  return { mat, variant, lot };
}

const testModeCfg: InvenTreeClientConfig = {
  testMode: true,
};

describe("syncPendingOnceLots", () => {
  it("pushes unpushed lots in test mode and marks inventreePushedAt", async () => {
    await withTestDb(async (db) => {
      const { lot } = await seedLot(db);
      expect(lot.inventreePushedAt).toBeNull();

      const result = await syncPendingOnceLots(db, testModeCfg);

      expect(result.scanned).toBe(1);
      expect(result.pushed).toBe(1);
      expect(result.failed).toBe(0);

      const [updated] = await db
        .select({ inventreePushedAt: schema.materialLots.inventreePushedAt })
        .from(schema.materialLots)
        .where(eq(schema.materialLots.id, lot.id));
      expect(updated?.inventreePushedAt).not.toBeNull();
    });
  });

  it("skips already-pushed lots (idempotent)", async () => {
    await withTestDb(async (db) => {
      await seedLot(db);
      await syncPendingOnceLots(db, testModeCfg); // first run — pushes it
      const result = await syncPendingOnceLots(db, testModeCfg); // second run — skip
      expect(result.scanned).toBe(0); // already pushed, not selected
    });
  });
});

describe("startInventorySyncLoop", () => {
  it("calls syncPendingOnceLots at least once and stops cleanly", async () => {
    await withTestDb(async (db) => {
      let ticks = 0;
      const handle = startInventorySyncLoop(db, testModeCfg, 0, () => {
        ticks++;
      });
      await new Promise<void>((res) => setTimeout(res, 20));
      handle.stop();
      await handle.promise;
      expect(ticks).toBeGreaterThanOrEqual(1);
    });
  });
});
