import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import {
  getLotProvenance,
  listLotsByVariant,
  receiveOffPo,
  updateLotQuality,
} from "../services/lot-service.js";

const offPoBody = z.object({
  materialVariantId: z.number().int().positive(),
  lot: z.object({
    lotCode: z.string().min(1),
    dyeLot: z.string().nullable().optional(),
    rollNumber: z.string().nullable().optional(),
    countryOfOrigin: z.string().length(2).nullable().optional(),
    quantityReceived: z.string(),
    certData: z.unknown().optional(),
    qualityStatus: z.enum(["pending_qc", "passed", "quarantined", "rejected"]).optional(),
    defectsNotes: z.string().nullable().optional(),
  }),
});

const qualityBody = z.object({
  qualityStatus: z.enum(["pending_qc", "passed", "quarantined", "rejected"]),
});

export async function registerLotRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/by-variant/:variantId", async (req) => {
    const variantId = Number((req.params as { variantId: string }).variantId);
    return listLotsByVariant(req.db, variantId);
  });

  app.get("/:id/provenance", async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getLotProvenance(req.db, id);
  });

  app.post(
    "/off-po",
    { preHandler: requireAuth(["admin", "inventory_staff"]) },
    async (req, reply) => {
      const body = offPoBody.parse(req.body);
      const lot = await receiveOffPo(req.db, { ...body, actorUserId: req.currentUser?.id });
      return reply.status(201).send(lot);
    },
  );

  app.post(
    "/:id/quality",
    { preHandler: requireAuth(["admin", "inventory_staff", "production_staff"]) },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      const body = qualityBody.parse(req.body);
      return updateLotQuality(req.db, id, body.qualityStatus, req.currentUser?.id);
    },
  );
}
