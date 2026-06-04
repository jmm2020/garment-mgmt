import { setTimeout as delay } from "node:timers/promises";
import { schema, type Database } from "@garment-mgmt/db";
import { eq, isNull } from "drizzle-orm";
import {
  findOrCreatePart,
  receiveStock,
  type InvenTreeClientConfig,
} from "../integrations/inventree-client.js";
import { recordAudit } from "../services/audit-service.js";
import type { LoopHandle } from "./loop-handle.js";

export interface SyncOnceResult {
  scanned: number;
  pushed: number;
  failed: number;
}

// At-least-once: if the DB stamp fails after a successful InvenTree call, the lot re-syncs next tick.
export async function syncPendingOnceLots(
  db: Database,
  cfg: InvenTreeClientConfig,
): Promise<SyncOnceResult> {
  const rows = await db
    .select({
      lotId: schema.materialLots.id,
      lotCode: schema.materialLots.lotCode,
      quantityReceived: schema.materialLots.quantityReceived,
      variantSku: schema.materialVariants.variantSku,
      materialName: schema.materials.name,
    })
    .from(schema.materialLots)
    .innerJoin(
      schema.materialVariants,
      eq(schema.materialVariants.id, schema.materialLots.materialVariantId),
    )
    .innerJoin(schema.materials, eq(schema.materials.id, schema.materialVariants.materialId))
    .where(isNull(schema.materialLots.inventreePushedAt))
    .orderBy(schema.materialLots.receivedAt);

  let pushed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const part = await findOrCreatePart(cfg, {
        name: row.materialName,
        sku: row.variantSku,
      });

      await receiveStock(cfg, {
        partId: part.pk,
        quantity: Number(row.quantityReceived),
        locationId: cfg.defaultLocationId,
        batch: row.lotCode,
      });

      const pushedAt = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(schema.materialLots)
          .set({ inventreePushedAt: pushedAt, updatedAt: pushedAt })
          .where(eq(schema.materialLots.id, row.lotId));

        await recordAudit({
          db: tx,
          entityType: "material_lot",
          entityId: row.lotId,
          action: "inventree_sync.pushed",
          after: { lotCode: row.lotCode, inventreePushedAt: pushedAt.toISOString() },
        });
      });

      pushed++;
    } catch (err) {
      console.error(`[inventree-sync] lot ${row.lotId} (${row.lotCode}) failed:`, err);
      failed++;
    }
  }

  return { scanned: rows.length, pushed, failed };
}

/** Background poller — mirrors startInventoryPushLoop from shopify-inventory-push. */
export function startInventorySyncLoop(
  db: Database,
  cfg: InvenTreeClientConfig,
  intervalMs: number,
  onTick?: (r: SyncOnceResult) => void,
): LoopHandle {
  let stopped = false;
  const promise = (async () => {
    while (!stopped) {
      try {
        const r = await syncPendingOnceLots(db, cfg);
        onTick?.(r);
      } catch (err) {
        console.error("[inventree-sync] tick failed:", err);
      }
      await delay(intervalMs);
    }
  })();
  return {
    stop: () => {
      stopped = true;
    },
    promise,
  };
}
