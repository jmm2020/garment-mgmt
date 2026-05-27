import { setTimeout as delay } from "node:timers/promises";
import { schema, type Database } from "@garment-mgmt/db";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  cacheVariantGid,
  markBatchMetafieldWritten,
  markShopifyPushed,
  recordBatchMetafieldFailure,
  recordShopifyFailure,
} from "../services/production-batch-queries.js";
import {
  inventoryAdjustQuantities,
  lookupShopifyVariantGid,
  setVariantMetafield,
  type ShopifyClientConfig,
} from "../integrations/shopify-client.js";

export interface PushOnceResult {
  scanned: number;
  pushed: number;
  failed: number;
  metafieldSet: number;
  metafieldFailed: number;
}

/**
 * Single sweep: find every `completed` batch where EITHER `shopify_pushed_at IS NULL`
 * (inventory not yet pushed) OR `shopify_batch_metafield_at IS NULL` (metafield not
 * yet written). For each row, run two phases:
 *
 *   1. Inventory: skip if `shopify_pushed_at` is set; otherwise call
 *      `inventoryAdjustQuantities`, mark on success, record failure and continue
 *      on failure (do not attempt metafield without successful inventory push).
 *   2. Metafield: skip if `shopify_batch_metafield_at` is set; otherwise resolve
 *      the variant GID (cached on product_variants.shopify_variant_gid; looked up
 *      from Shopify if absent), then call `setVariantMetafield` to write
 *      `garment_mgmt/last_batch_no = batchNo`.
 *
 * Idempotent — both phases have their own marker columns. A partial failure
 * (inventory ok, metafield failed) is retried on the next tick without re-pushing
 * inventory. See ADR-0007.
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
      shopifyPushedAt: schema.productionBatches.shopifyPushedAt,
      shopifyBatchMetafieldAt: schema.productionBatches.shopifyBatchMetafieldAt,
      sku: schema.productVariants.sku,
      variantId: schema.productVariants.id,
      shopifyVariantGid: schema.productVariants.shopifyVariantGid,
    })
    .from(schema.productionBatches)
    .innerJoin(
      schema.productVariants,
      eq(schema.productVariants.id, schema.productionBatches.productVariantId),
    )
    .where(
      and(
        eq(schema.productionBatches.status, "completed"),
        or(
          isNull(schema.productionBatches.shopifyPushedAt),
          isNull(schema.productionBatches.shopifyBatchMetafieldAt),
        ),
      ),
    )
    .orderBy(schema.productionBatches.completedAt);

  let pushed = 0;
  let failed = 0;
  let metafieldSet = 0;
  let metafieldFailed = 0;

  for (const row of rows) {
    let inventoryOk = row.shopifyPushedAt !== null;
    if (!inventoryOk) {
      if (!row.sku) {
        await recordShopifyFailure(db, row.id, {
          error: "variant has no canonical sku — backfill required",
          batchNo: row.batchNo,
        });
        failed++;
        continue;
      }
      // Shopify inventory counts are whole-unit integers; qtyActual is numeric(12,4)
      // rounded here intentionally — fractional garment quantities are not expected.
      const delta = Math.round(Number(row.qtyActual ?? "0"));
      const result = await inventoryAdjustQuantities(cfg, row.sku, delta);
      if (result.ok) {
        await db.transaction(async (tx) => {
          await markShopifyPushed(tx, row.id, new Date(), {
            sku: row.sku,
            delta,
            attempts: result.attempts,
            testMode: result.testMode,
          });
        });
        pushed++;
        inventoryOk = true;
      } else {
        await recordShopifyFailure(db, row.id, {
          sku: row.sku,
          delta,
          attempts: result.attempts,
          error: result.error,
        });
        failed++;
        continue;
      }
    }

    if (row.shopifyBatchMetafieldAt !== null) continue;
    if (!row.sku) {
      await recordBatchMetafieldFailure(db, row.id, {
        batchNo: row.batchNo,
        error: "variant has no canonical sku — metafield write skipped",
      });
      metafieldFailed++;
      continue;
    }

    let variantGid: string | null = row.shopifyVariantGid ?? null;
    if (!variantGid) {
      const lookup = await lookupShopifyVariantGid(cfg, row.sku);
      if (!lookup.ok || !lookup.gid) {
        await recordBatchMetafieldFailure(db, row.id, {
          batchNo: row.batchNo,
          sku: row.sku,
          attempts: lookup.attempts,
          error: lookup.error ?? "gid lookup failed",
        });
        metafieldFailed++;
        continue;
      }
      variantGid = lookup.gid;
      await cacheVariantGid(db, row.variantId, variantGid);
    }

    const mf = await setVariantMetafield(cfg, variantGid, row.batchNo);
    if (mf.ok) {
      await db.transaction(async (tx) => {
        await markBatchMetafieldWritten(tx, row.id, new Date(), {
          batchNo: row.batchNo,
          variantGid,
          attempts: mf.attempts,
          testMode: mf.testMode,
        });
      });
      metafieldSet++;
    } else {
      await recordBatchMetafieldFailure(db, row.id, {
        batchNo: row.batchNo,
        variantGid,
        attempts: mf.attempts,
        error: mf.error,
      });
      metafieldFailed++;
    }
  }
  return { scanned: rows.length, pushed, failed, metafieldSet, metafieldFailed };
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
