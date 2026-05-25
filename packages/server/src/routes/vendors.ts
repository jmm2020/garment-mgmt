import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import {
  archiveVendor,
  createVendor,
  getVendor,
  listVendors,
  updateVendor,
} from "../services/vendor-service.js";

const vendorTypeEnum = z.enum([
  "mill",
  "trim_supplier",
  "dye_house",
  "cut_make",
  "notion",
  "label",
  "other",
]);

const createBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  vendorType: vendorTypeEnum,
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  address: z.unknown().optional(),
  certifications: z.unknown().optional(),
  country: z.string().length(2).nullable().optional(),
});

const updateBody = createBody.partial().omit({ code: true });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursorCreatedAt: z.string().datetime().optional(),
  cursorId: z.coerce.number().int().positive().optional(),
});

export async function registerVendorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (req) => {
    const q = listQuery.parse(req.query);
    const cursor =
      q.cursorCreatedAt && q.cursorId
        ? { createdAt: new Date(q.cursorCreatedAt), id: q.cursorId }
        : null;
    return listVendors(req.db, { limit: q.limit, cursor });
  });

  app.get("/:id", async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getVendor(req.db, id);
  });

  app.post(
    "/",
    { preHandler: requireAuth(["admin", "inventory_staff", "production_staff"]) },
    async (req, reply) => {
      const body = createBody.parse(req.body);
      const vendor = await createVendor(req.db, { ...body, actorUserId: req.currentUser?.id });
      return reply.status(201).send(vendor);
    },
  );

  app.patch("/:id", { preHandler: requireAuth(["admin", "inventory_staff"]) }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = updateBody.parse(req.body);
    return updateVendor(req.db, id, { ...body, actorUserId: req.currentUser?.id });
  });

  app.delete("/:id", { preHandler: requireAuth(["admin"]) }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    return archiveVendor(req.db, id, req.currentUser?.id);
  });
}
