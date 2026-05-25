import { schema, type Database } from "@garment-mgmt/db";
import { and, desc, eq, gt, or } from "drizzle-orm";
import { NotFoundError } from "../errors.js";
import { recordAudit } from "./audit-service.js";

type Vendor = schema.Vendor;

export interface CreateVendorInput {
  code: string;
  name: string;
  vendorType: schema.VendorType;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: unknown;
  certifications?: unknown;
  country?: string | null;
  actorUserId?: number;
}

export async function createVendor(db: Database, input: CreateVendorInput): Promise<Vendor> {
  return db.transaction(async (tx) => {
    const [vendor] = await tx
      .insert(schema.vendors)
      .values({
        code: input.code,
        name: input.name,
        vendorType: input.vendorType,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        address: input.address ?? null,
        certifications: input.certifications ?? {},
        country: input.country ?? null,
      })
      .returning();
    if (!vendor) throw new Error("vendor insert returned no row");
    await recordAudit({
      db: tx,
      entityType: "vendor",
      entityId: vendor.id,
      action: "create",
      actorUserId: input.actorUserId,
      after: vendor,
    });
    return vendor;
  });
}

export interface UpdateVendorInput {
  name?: string;
  vendorType?: schema.VendorType;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: unknown;
  certifications?: unknown;
  country?: string | null;
  actorUserId?: number;
}

export async function updateVendor(
  db: Database,
  id: number,
  input: UpdateVendorInput,
): Promise<Vendor> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.vendors).where(eq(schema.vendors.id, id));
    if (!before) throw new NotFoundError("vendor", id);

    const [after] = await tx
      .update(schema.vendors)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.vendorType !== undefined ? { vendorType: input.vendorType } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.certifications !== undefined ? { certifications: input.certifications } : {}),
        ...(input.country !== undefined ? { country: input.country } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.vendors.id, id))
      .returning();

    if (!after) throw new NotFoundError("vendor", id);
    await recordAudit({
      db: tx,
      entityType: "vendor",
      entityId: id,
      action: "update",
      actorUserId: input.actorUserId,
      before,
      after,
    });
    return after;
  });
}

export async function archiveVendor(
  db: Database,
  id: number,
  actorUserId?: number,
): Promise<Vendor> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.vendors).where(eq(schema.vendors.id, id));
    if (!before) throw new NotFoundError("vendor", id);

    const [after] = await tx
      .update(schema.vendors)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(schema.vendors.id, id))
      .returning();
    if (!after) throw new NotFoundError("vendor", id);

    await recordAudit({
      db: tx,
      entityType: "vendor",
      entityId: id,
      action: "state_transition:active->archived",
      actorUserId,
      before,
      after,
    });
    return after;
  });
}

export interface ListVendorsInput {
  limit?: number;
  cursor?: { createdAt: Date; id: number } | null;
}

export async function listVendors(
  db: Database,
  input: ListVendorsInput = {},
): Promise<{ items: Vendor[]; nextCursor: { createdAt: Date; id: number } | null }> {
  const limit = Math.min(input.limit ?? 50, 200);
  const whereExpr = input.cursor
    ? or(
        gt(schema.vendors.createdAt, input.cursor.createdAt),
        and(
          eq(schema.vendors.createdAt, input.cursor.createdAt),
          gt(schema.vendors.id, input.cursor.id),
        ),
      )
    : undefined;
  const rows = await db
    .select()
    .from(schema.vendors)
    .where(whereExpr)
    .orderBy(desc(schema.vendors.createdAt), desc(schema.vendors.id))
    .limit(limit + 1);

  const items = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit && items.length > 0
      ? { createdAt: items[items.length - 1]!.createdAt, id: items[items.length - 1]!.id }
      : null;
  return { items, nextCursor };
}

export async function getVendor(db: Database, id: number): Promise<Vendor> {
  const [vendor] = await db.select().from(schema.vendors).where(eq(schema.vendors.id, id));
  if (!vendor) throw new NotFoundError("vendor", id);
  return vendor;
}
