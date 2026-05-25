import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import {
  activateBom,
  addComponent,
  approveBom,
  createBom,
  getBom,
  listBomsForProduct,
  removeComponent,
} from "../services/bom-service.js";

const uomEnum = z.enum(["yard", "meter", "each", "gram", "kilogram"]);

const componentDraft = z.object({
  materialVariantId: z.number().int().positive(),
  quantityPerUnit: z.string(),
  unitOfMeasure: uomEnum,
  position: z.string().nullable().optional(),
  isVisiblePanel: z.boolean().optional(),
  sizeCurve: z.record(z.string(), z.number()).nullable().optional(),
  wasteFactorPct: z.string().optional(),
  isOptional: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const createBody = z.object({
  productId: z.number().int().positive(),
  components: z.array(componentDraft).default([]),
  notes: z.string().nullable().optional(),
});

export async function registerBomRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.post("/", { preHandler: requireAuth(["admin", "production_staff"]) }, async (req, reply) => {
    const body = createBody.parse(req.body);
    const bom = await createBom(req.db, { ...body, actorUserId: req.currentUser?.id });
    return reply.status(201).send(bom);
  });

  app.get("/:id", async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getBom(req.db, id);
  });

  app.get("/by-product/:productId", async (req) => {
    const productId = Number((req.params as { productId: string }).productId);
    return listBomsForProduct(req.db, productId);
  });

  app.post(
    "/:id/components",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const body = componentDraft.parse(req.body);
      const component = await addComponent(req.db, id, body, req.currentUser?.id);
      return reply.status(201).send(component);
    },
  );

  app.delete(
    "/components/:componentId",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req, reply) => {
      const componentId = Number((req.params as { componentId: string }).componentId);
      await removeComponent(req.db, componentId, req.currentUser?.id);
      return reply.status(204).send();
    },
  );

  app.post(
    "/:id/approve",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      if (!req.currentUser) throw new Error("missing user");
      return approveBom(req.db, id, req.currentUser.id);
    },
  );

  app.post(
    "/:id/activate",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      if (!req.currentUser) throw new Error("missing user");
      return activateBom(req.db, id, req.currentUser.id);
    },
  );
}
