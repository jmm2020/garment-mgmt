import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { getBatch, listBatches, type BatchRef } from "../services/production-batch-queries.js";
import {
  cancelBatch,
  completeBatch,
  receiveFromCutter,
  stageForProduction,
  startProduction,
  submitForQc,
} from "../services/production-batch-service.js";

const createBody = z.object({
  cutTicketId: z.number().int().positive(),
  productVariantId: z.number().int().positive(),
  qtyPlanned: z.string(),
  cutterUserId: z.number().int().positive(),
  notes: z.string().nullable().optional(),
  force: z.boolean().optional(),
});

const qtyBody = z.object({ qty: z.string() });
const completeBody = z.object({
  qty: z.string(),
  verdict: z.enum(["pass", "fail", "pass_with_notes"]),
  note: z.string().nullable().optional(),
});
const cancelBody = z.object({ reason: z.string().min(1) });

const listQuery = z.object({
  status: z
    .enum([
      "received_from_cutter",
      "staged_pre_prod",
      "in_production",
      "awaiting_qc",
      "completed",
      "cancelled",
    ])
    .optional(),
  sku: z.string().optional(),
  since: z.string().optional(),
  cutterUserId: z.coerce.number().int().positive().optional(),
});

function parseRef(raw: string): BatchRef {
  // /batches/:ref accepts either numeric id or PB-YYYY-#### batch_no.
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export async function registerBatchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (req) => {
    const q = listQuery.parse(req.query ?? {});
    return listBatches(req.db, q);
  });

  app.get("/:ref", async (req) => {
    const ref = parseRef((req.params as { ref: string }).ref);
    return getBatch(req.db, ref);
  });

  app.post("/", { preHandler: requireAuth(["admin", "production_staff"]) }, async (req, reply) => {
    const body = createBody.parse(req.body);
    const batch = await receiveFromCutter(req.db, {
      ...body,
      actorUserId: req.currentUser?.id,
    });
    return reply.status(201).send(batch);
  });

  app.post(
    "/:ref/stage",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const ref = parseRef((req.params as { ref: string }).ref);
      return stageForProduction(req.db, ref, req.currentUser?.id);
    },
  );

  app.post(
    "/:ref/start",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const ref = parseRef((req.params as { ref: string }).ref);
      return startProduction(req.db, ref, req.currentUser?.id);
    },
  );

  app.post(
    "/:ref/submit-qc",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const ref = parseRef((req.params as { ref: string }).ref);
      const body = qtyBody.parse(req.body);
      return submitForQc(req.db, { ref, qty: body.qty, actorUserId: req.currentUser?.id });
    },
  );

  app.post(
    "/:ref/complete",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const ref = parseRef((req.params as { ref: string }).ref);
      const body = completeBody.parse(req.body);
      return completeBatch(req.db, { ref, ...body, actorUserId: req.currentUser?.id });
    },
  );

  app.post(
    "/:ref/cancel",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const ref = parseRef((req.params as { ref: string }).ref);
      const body = cancelBody.parse(req.body);
      return cancelBatch(req.db, { ref, reason: body.reason, actorUserId: req.currentUser?.id });
    },
  );
}
