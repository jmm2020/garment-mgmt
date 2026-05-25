import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import {
  addProductVariant,
  createProduct,
  getProduct,
  listProducts,
} from "../services/product-service.js";

const createBody = z.object({
  styleCode: z.string().min(1),
  name: z.string().min(1),
  season: z.string().nullable().optional(),
  baseSamMinutes: z.string().nullable().optional(),
  targetCogsCents: z.number().int().nonnegative().nullable().optional(),
  description: z.string().nullable().optional(),
});

const variantBody = z.object({
  size: z.string().min(1),
  colorway: z.string().min(1),
  fgSku: z.string().min(1),
  upc: z.string().nullable().optional(),
});

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (req) => listProducts(req.db));
  app.get("/:id", async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getProduct(req.db, id);
  });

  app.post("/", { preHandler: requireAuth(["admin", "production_staff"]) }, async (req, reply) => {
    const body = createBody.parse(req.body);
    const product = await createProduct(req.db, { ...body, actorUserId: req.currentUser?.id });
    return reply.status(201).send(product);
  });

  app.post(
    "/:id/variants",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const body = variantBody.parse(req.body);
      const variant = await addProductVariant(req.db, {
        productId: id,
        ...body,
        actorUserId: req.currentUser?.id,
      });
      return reply.status(201).send(variant);
    },
  );
}
