import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { AuthError } from "../errors.js";
import {
  getPvtAuthorization,
  getPvtRun,
  listPvtRuns,
  type RunRef,
} from "../services/pvt-queries.js";
import {
  cancelPvtRun,
  createPvtRun,
  markPvtReceived,
  markPvtShipped,
  rejectPvt,
  validatePvt,
} from "../services/pvt-service.js";

const createBody = z.object({
  productVariantId: z.number().int().positive(),
  markerId: z.number().int().positive(),
  cutterUserId: z.number().int().positive(),
  cutTicketId: z.number().int().positive(),
  notes: z.string().nullable().optional(),
});

const validateBody = z.object({ notes: z.string().nullable().optional() });
const reasonBody = z.object({ reason: z.string().min(1) });

const listQuery = z.object({
  status: z.enum(["cutting", "shipped", "inspecting", "validated", "rejected", "cancelled"]).optional(),
  variantId: z.coerce.number().int().positive().optional(),
  activeOnly: z.coerce.boolean().optional(),
});

function parseRef(raw: string): RunRef {
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export async function registerPvtRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (req) => {
    const q = listQuery.parse(req.query ?? {});
    return listPvtRuns(req.db, q);
  });

  app.get("/:ref", async (req) => {
    const ref = parseRef((req.params as { ref: string }).ref);
    return getPvtRun(req.db, ref);
  });

  app.post("/", { preHandler: requireAuth(["admin", "production_staff"]) }, async (req, reply) => {
    const body = createBody.parse(req.body);
    const run = await createPvtRun(req.db, { ...body, actorUserId: req.currentUser?.id });
    return reply.status(201).send(run);
  });

  app.post(
    "/:ref/ship",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const ref = parseRef((req.params as { ref: string }).ref);
      return markPvtShipped(req.db, ref, req.currentUser?.id);
    },
  );

  app.post(
    "/:ref/receive",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const ref = parseRef((req.params as { ref: string }).ref);
      return markPvtReceived(req.db, ref, req.currentUser?.id);
    },
  );

  app.post(
    "/:ref/validate",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const ref = parseRef((req.params as { ref: string }).ref);
      const body = validateBody.parse(req.body ?? {});
      const validatorUserId = req.currentUser?.id;
      if (!validatorUserId) throw new AuthError("unauthorized", "validator user required");
      return validatePvt(req.db, { ref, validatorUserId, notes: body.notes });
    },
  );

  app.post(
    "/:ref/reject",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const ref = parseRef((req.params as { ref: string }).ref);
      const body = reasonBody.parse(req.body);
      const validatorUserId = req.currentUser?.id;
      if (!validatorUserId) throw new AuthError("unauthorized", "validator user required");
      return rejectPvt(req.db, { ref, validatorUserId, reason: body.reason });
    },
  );

  app.post(
    "/:ref/cancel",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const ref = parseRef((req.params as { ref: string }).ref);
      const body = reasonBody.parse(req.body);
      const actorUserId = req.currentUser?.id;
      if (!actorUserId) throw new AuthError("unauthorized", "actor user required");
      return cancelPvtRun(req.db, { ref, actorUserId, reason: body.reason });
    },
  );
}

const pvtStatusQuery = z.object({ markerId: z.coerce.number().int().positive() });

/**
 * Convenience read: is a (variant, marker) pair authorized for production right now?
 * Mounted at /api/products/:variantId/pvt-status so the operator can pre-check before
 * trying to receive a batch.
 */
export async function registerPvtStatusRoute(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/:variantId/pvt-status", async (req) => {
    const variantId = Number((req.params as { variantId: string }).variantId);
    const { markerId } = pvtStatusQuery.parse(req.query ?? {});
    return getPvtAuthorization(req.db, variantId, markerId);
  });
}
