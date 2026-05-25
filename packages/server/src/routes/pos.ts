import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { receivePoLine } from "../services/lot-service.js";
import { addLine, confirmPo, createPo, getPo, listPos, sendPo } from "../services/po-service.js";

const createBody = z.object({
  poNumber: z.string().min(1),
  vendorId: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  expectedAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const lineBody = z.object({
  materialVariantId: z.number().int().positive(),
  quantityOrdered: z.string(),
  unitCost: z.string(),
  notes: z.string().nullable().optional(),
});

const receiveBody = z.object({
  lots: z.array(
    z.object({
      lotCode: z.string().min(1),
      dyeLot: z.string().nullable().optional(),
      rollNumber: z.string().nullable().optional(),
      countryOfOrigin: z.string().length(2).nullable().optional(),
      quantityReceived: z.string(),
      certData: z.unknown().optional(),
      qualityStatus: z.enum(["pending_qc", "passed", "quarantined", "rejected"]).optional(),
      defectsNotes: z.string().nullable().optional(),
    }),
  ),
});

export async function registerPoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (req) => listPos(req.db));
  app.get("/:id", async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getPo(req.db, id);
  });

  app.post("/", { preHandler: requireAuth(["admin", "inventory_staff"]) }, async (req, reply) => {
    const body = createBody.parse(req.body);
    const po = await createPo(req.db, { ...body, actorUserId: req.currentUser?.id });
    return reply.status(201).send(po);
  });

  app.post(
    "/:id/lines",
    { preHandler: requireAuth(["admin", "inventory_staff"]) },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const body = lineBody.parse(req.body);
      const line = await addLine(req.db, {
        poId: id,
        ...body,
        actorUserId: req.currentUser?.id,
      });
      return reply.status(201).send(line);
    },
  );

  app.post("/:id/send", { preHandler: requireAuth(["admin", "inventory_staff"]) }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    return sendPo(req.db, id, req.currentUser?.id);
  });

  app.post(
    "/:id/confirm",
    { preHandler: requireAuth(["admin", "inventory_staff"]) },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      return confirmPo(req.db, id, req.currentUser?.id);
    },
  );

  app.post(
    "/lines/:lineId/receive",
    { preHandler: requireAuth(["admin", "inventory_staff"]) },
    async (req) => {
      const lineId = Number((req.params as { lineId: string }).lineId);
      const body = receiveBody.parse(req.body);
      return receivePoLine(req.db, {
        poLineId: lineId,
        lots: body.lots,
        actorUserId: req.currentUser?.id,
      });
    },
  );
}
