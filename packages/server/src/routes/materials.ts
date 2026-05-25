import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import {
  addVariant,
  createMaterial,
  getMaterial,
  listMaterials,
  updateMaterial,
} from "../services/material-service.js";

const materialTypeEnum = z.enum([
  "fabric_shell",
  "fabric_lining",
  "fabric_insulation",
  "zipper",
  "snap",
  "button",
  "thread",
  "label",
  "tape",
  "webbing",
  "elastic",
  "other",
]);

const uomEnum = z.enum(["yard", "meter", "each", "gram", "kilogram"]);

const createBody = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  materialType: materialTypeEnum,
  unitOfMeasure: uomEnum,
  composition: z.unknown().optional(),
  preferredVendorId: z.number().int().positive().nullable().optional(),
  reorderPoint: z.string().optional().nullable(),
  targetStock: z.string().optional().nullable(),
  notes: z.string().nullable().optional(),
});

const variantBody = z.object({
  variantSku: z.string().min(1),
  colorway: z.string().nullable().optional(),
  sizeSpec: z.string().nullable().optional(),
});

export async function registerMaterialRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (req) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursorCreatedAt: z.string().datetime().optional(),
        cursorId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    const cursor =
      q.cursorCreatedAt && q.cursorId
        ? { createdAt: new Date(q.cursorCreatedAt), id: q.cursorId }
        : null;
    return listMaterials(req.db, { limit: q.limit, cursor });
  });

  app.get("/:id", async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getMaterial(req.db, id);
  });

  app.post("/", { preHandler: requireAuth(["admin", "inventory_staff"]) }, async (req, reply) => {
    const body = createBody.parse(req.body);
    const material = await createMaterial(req.db, {
      ...body,
      actorUserId: req.currentUser?.id,
    });
    return reply.status(201).send(material);
  });

  app.patch("/:id", { preHandler: requireAuth(["admin", "inventory_staff"]) }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = createBody.partial().omit({ sku: true }).parse(req.body);
    return updateMaterial(req.db, id, { ...body, actorUserId: req.currentUser?.id });
  });

  app.post(
    "/:id/variants",
    { preHandler: requireAuth(["admin", "inventory_staff"]) },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const body = variantBody.parse(req.body);
      const variant = await addVariant(req.db, {
        materialId: id,
        ...body,
        actorUserId: req.currentUser?.id,
      });
      return reply.status(201).send(variant);
    },
  );
}
