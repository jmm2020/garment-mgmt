import { schema, type Database, type DbExecutor } from "@garment-mgmt/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { NotFoundError } from "../errors.js";

type Run = schema.ProductionValidationRun;
type PvtStatus = schema.PvtStatus;

export type RunRef = number | string;

export interface PvtAuthorization {
  authorized: boolean;
  mostRecentRun?: Run;
  expiresAt?: Date | null;
  reason?: "no_pvt" | "expired" | "rejected" | "in_progress";
}

/**
 * Returns the current PVT authorization for a (variantId, markerId) pair. A pair is
 * authorized iff there is at least one `validated` PVT whose `expires_at > now()`.
 * Rejected and cancelled PVTs do not count, regardless of recency.
 */
export async function getPvtAuthorization(
  db: DbExecutor,
  productVariantId: number,
  markerId: number,
): Promise<PvtAuthorization> {
  const [recent] = await db
    .select()
    .from(schema.productionValidationRuns)
    .where(
      and(
        eq(schema.productionValidationRuns.productVariantId, productVariantId),
        eq(schema.productionValidationRuns.markerId, markerId),
      ),
    )
    .orderBy(desc(schema.productionValidationRuns.createdAt))
    .limit(1);

  if (!recent) return { authorized: false, reason: "no_pvt" };

  if (recent.status === "validated") {
    const expiresAt = recent.expiresAt;
    if (expiresAt && expiresAt.getTime() > Date.now()) {
      return { authorized: true, mostRecentRun: recent, expiresAt };
    }
    return { authorized: false, mostRecentRun: recent, expiresAt, reason: "expired" };
  }

  if (recent.status === "rejected") {
    return { authorized: false, mostRecentRun: recent, reason: "rejected" };
  }

  return { authorized: false, mostRecentRun: recent, reason: "in_progress" };
}

export interface ListPvtFilter {
  status?: PvtStatus;
  variantId?: number;
  activeOnly?: boolean;
}

export async function listPvtRuns(db: Database, filter: ListPvtFilter = {}): Promise<Run[]> {
  const conditions = [] as ReturnType<typeof eq>[];
  if (filter.status) conditions.push(eq(schema.productionValidationRuns.status, filter.status));
  if (filter.variantId) {
    conditions.push(eq(schema.productionValidationRuns.productVariantId, filter.variantId));
  }
  if (filter.activeOnly) {
    conditions.push(
      sql`${schema.productionValidationRuns.status} IN ('cutting','shipped','inspecting')`,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select()
    .from(schema.productionValidationRuns)
    .where(where)
    .orderBy(desc(schema.productionValidationRuns.createdAt));
}

export async function getPvtRun(db: Database, ref: RunRef): Promise<Run> {
  return loadRun(db, ref);
}

export async function loadRun(db: DbExecutor, ref: RunRef): Promise<Run> {
  const where =
    typeof ref === "number"
      ? eq(schema.productionValidationRuns.id, ref)
      : eq(schema.productionValidationRuns.runNo, ref);
  const [run] = await db.select().from(schema.productionValidationRuns).where(where);
  if (!run) throw new NotFoundError("production_validation_run", String(ref));
  return run;
}
