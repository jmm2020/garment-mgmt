import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import {
  cancelCutTicket,
  closeCutTicket,
  createCutTicket,
  getCutTicket,
  listCutTickets,
  markInCutting,
} from "../services/cut-ticket-service.js";

const createBody = z.object({
  ticketNumber: z.string().min(1),
  productId: z.number().int().positive(),
  bomId: z.number().int().positive(),
  markerId: z.number().int().positive().nullable().optional(),
  plannedQuantityBySize: z.record(z.string(), z.number().int().nonnegative()),
  targetCompletionAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  allowDyeLotSplit: z.boolean().optional(),
});

const closeBody = z.object({
  actuals: z.array(
    z.object({
      cutTicketLotId: z.number().int().positive(),
      actualQuantityCut: z.string(),
      actualQuantityReturned: z.string().optional(),
    }),
  ),
});

const cancelBody = z.object({
  reason: z.string().min(1),
});

export async function registerCutTicketRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (req) => listCutTickets(req.db));
  app.get("/:id", async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getCutTicket(req.db, id);
  });

  app.post("/", { preHandler: requireAuth(["admin", "production_staff"]) }, async (req, reply) => {
    const body = createBody.parse(req.body);
    const ticket = await createCutTicket(req.db, {
      ...body,
      actorUserId: req.currentUser?.id,
    });
    return reply.status(201).send(ticket);
  });

  app.post(
    "/:id/start",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      return markInCutting(req.db, id, req.currentUser?.id);
    },
  );

  app.post(
    "/:id/close",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      const body = closeBody.parse(req.body);
      return closeCutTicket(req.db, {
        ticketId: id,
        actuals: body.actuals,
        actorUserId: req.currentUser?.id,
      });
    },
  );

  app.post(
    "/:id/cancel",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      const body = cancelBody.parse(req.body);
      return cancelCutTicket(req.db, id, body.reason, req.currentUser?.id);
    },
  );
}
