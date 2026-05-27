import { setTimeout as delay } from "node:timers/promises";
import { schema, type Database } from "@garment-mgmt/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { markShopifyPushed, recordShopifyFailure } from "../services/production-batch-queries.js";
import {
  inventoryAdjustQuantities,
  type ShopifyClientConfig,
} from "../integrations/shopify-client.js";

export interface PushOnceResult {
  scanned: number;
  pushed: number;
  failed: number;
}

/**
 * Single sweep: find every `completed` batch with `shopify_pushed_at IS NULL`, push its
 * delta to Shopify, mark on success / record failure on failure. Idempotent — calling
 * this twice in a row is safe; succeeded rows have `shopify_pushed_at` set and are
 * filtered out on the second pass.
 */
export async function pushPendingOnce(
  db: Database,
  cfg: ShopifyClientConfig,
): Promise<PushOnceResult> {
  const rows = await db
    .select({
      id: schema.productionBatches.id,
      batchNo: schema.productionBatches.batchNo,
      qtyActual: schema.productionBatches.qtyActual,
      sku: schema.productVariants.sku,
    })
    .from(schema.productionBatches)
    .innerJoin(
      schema.productVariants,
      eq(schema.productVariants.id, schema.productionBatches.productVariantId),
    )
    .where(
      and(
        eq(schema.productionBatches.status, "completed"),
        isNull(schema.productionBatches.shopifyPushedAt),
      ),
    )
    .orderBy(sql`${schema.productionBatches.completedAt} ASC`);

  let pushed = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.sku) {
      await recordShopifyFailure(db, row.id, {
        error: "variant has no canonical sku — backfill required",
        batchNo: row.batchNo,
      });
      failed++;
      continue;
    }
    const delta = Number(row.qtyActual ?? "0");
    const result = await inventoryAdjustQuantities(cfg, row.sku, delta);
    if (result.ok) {
      await markShopifyPushed(db, row.id, new Date(), {
        sku: row.sku,
        delta,
        attempts: result.attempts,
        testMode: result.testMode,
      });
      pushed++;
    } else {
      await recordShopifyFailure(db, row.id, {
        sku: row.sku,
        delta,
        attempts: result.attempts,
        error: result.error,
      });
      failed++;
    }
  }
  return { scanned: rows.length, pushed, failed };
}

export interface PushLoopHandle {
  stop: () => void;
  promise: Promise<void>;
}

/**
 * Background poller. Calls pushPendingOnce on a fixed interval. The interval is
 * configurable via env SHOPIFY_PUSH_INTERVAL_MS (default 30s). Idempotent against
 * partial failures — failed rows stay `completed` + `shopify_pushed_at IS NULL`
 * and the next tick picks them up.
 */
export function startInventoryPushLoop(
  db: Database,
  cfg: ShopifyClientConfig,
  intervalMs: number,
  onTick?: (r: PushOnceResult) => void,
): PushLoopHandle {
  let stopped = false;
  const promise = (async () => {
    while (!stopped) {
      try {
        const r = await pushPendingOnce(db, cfg);
        onTick?.(r);
      } catch (err) {
        // Catch-all so a transient DB blip doesn't kill the loop. The next tick
        // will retry; persistent failures show up in production_events.
        console.error("[shopify-push] tick failed:", err);
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
