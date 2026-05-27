import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { NotFoundError, ValidationFailedError } from "../errors.js";

type ProductionBatch = schema.ProductionBatch;

export type BatchRef = number | string;

export interface GetBatchResult extends ProductionBatch {
  events: schema.ProductionEvent[];
}

export async function getBatch(db: Database, ref: BatchRef): Promise<GetBatchResult> {
  const batch = await loadBatch(db, ref);
  const events = await db
    .select()
    .from(schema.productionEvents)
    .where(eq(schema.productionEvents.batchId, batch.id))
    .orderBy(asc(schema.productionEvents.createdAt));
  return { ...batch, events };
}

export interface ListBatchesFilter {
  status?: schema.ProductionBatchStatus;
  sku?: string;
  since?: string;
  cutterUserId?: number;
}

export async function listBatches(
  db: Database,
  filter: ListBatchesFilter = {},
): Promise<ProductionBatch[]> {
  const conditions = [] as ReturnType<typeof eq>[];
  if (filter.status) conditions.push(eq(schema.productionBatches.status, filter.status));
  if (filter.cutterUserId) {
    conditions.push(eq(schema.productionBatches.cutterUserId, filter.cutterUserId));
  }
  if (filter.since) {
    const d = new Date(filter.since);
    if (Number.isNaN(d.getTime())) throw new ValidationFailedError("invalid since date");
    conditions.push(gte(schema.productionBatches.receivedAt, d));
  }
  if (filter.sku) {
    const variantIds = await db
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.sku, filter.sku));
    if (variantIds.length === 0) return [];
    conditions.push(
      sql`${schema.productionBatches.productVariantId} IN ${variantIds.map((v) => v.id)}`,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select()
    .from(schema.productionBatches)
    .where(where)
    .orderBy(desc(schema.productionBatches.receivedAt));
}

export async function markShopifyPushed(
  db: DbExecutor,
  batchId: number,
  pushedAt: Date,
  payload: Record<string, unknown>,
): Promise<void> {
  await db
    .update(schema.productionBatches)
    .set({ shopifyPushedAt: pushedAt, updatedAt: new Date() })
    .where(eq(schema.productionBatches.id, batchId));
  await db.insert(schema.productionEvents).values({
    batchId,
    eventType: "shopify_push_succeeded",
    payload,
  });
}

export async function recordShopifyFailure(
  db: DbExecutor,
  batchId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.productionEvents).values({
    batchId,
    eventType: "shopify_push_failed",
    payload,
  });
}

export async function cacheVariantGid(
  db: DbExecutor,
  variantId: number,
  gid: string,
): Promise<void> {
  // No production_event row — the GID is captured in the adjacent shopify_batch_metafield_set payload.
  await db
    .update(schema.productVariants)
    .set({ shopifyVariantGid: gid, updatedAt: new Date() })
    .where(eq(schema.productVariants.id, variantId));
}

export async function markBatchMetafieldWritten(
  db: DbExecutor,
  batchId: number,
  writtenAt: Date,
  payload: Record<string, unknown>,
): Promise<void> {
  await db
    .update(schema.productionBatches)
    .set({ shopifyBatchMetafieldAt: writtenAt, updatedAt: new Date() })
    .where(eq(schema.productionBatches.id, batchId));
  await db.insert(schema.productionEvents).values({
    batchId,
    eventType: "shopify_batch_metafield_set",
    payload,
  });
}

export async function recordBatchMetafieldFailure(
  db: DbExecutor,
  batchId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.productionEvents).values({
    batchId,
    eventType: "shopify_batch_metafield_failed",
    payload,
  });
}

export async function loadBatch(db: DbExecutor, ref: BatchRef): Promise<ProductionBatch> {
  const where =
    typeof ref === "number"
      ? eq(schema.productionBatches.id, ref)
      : eq(schema.productionBatches.batchNo, ref);
  const [batch] = await db.select().from(schema.productionBatches).where(where);
  if (!batch) throw new NotFoundError("production_batch", String(ref));
  return batch;
}
