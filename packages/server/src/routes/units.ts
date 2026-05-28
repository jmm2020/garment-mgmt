import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { ValidationFailedError } from "../errors.js";
import {
  getUnit,
  listBatchUnits,
  recordUnitQcVerdict,
} from "../services/production-unit-service.js";

const listQuery = z.object({
  verdict: z.enum(["pass", "fail", "pass_with_notes"]).optional(),
});

const qcBody = z.object({
  verdict: z.enum(["pass", "fail", "pass_with_notes"]),
  reason: z.string().nullable().optional(),
});

export async function registerUnitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/:serial", async (req) => {
    const { serial } = req.params as { serial: string };
    return getUnit(req.db, serial);
  });
}

export async function registerBatchUnitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/:batchId/units", async (req) => {
    const { batchId } = req.params as { batchId: string };
    const id = parseInt(batchId, 10);
    if (!Number.isFinite(id)) throw new ValidationFailedError("batchId must be a number");
    const { verdict } = listQuery.parse(req.query ?? {});
    return listBatchUnits(req.db, id, verdict ? { verdict } : undefined);
  });

  app.post(
    "/:batchId/units/:serial/qc",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const { batchId, serial } = req.params as { batchId: string; serial: string };
      const id = parseInt(batchId, 10);
      if (!Number.isFinite(id)) throw new ValidationFailedError("batchId must be a number");
      const body = qcBody.parse(req.body);
      return recordUnitQcVerdict(req.db, {
        unitSerial: serial,
        batchId: id,
        verdict: body.verdict,
        reason: body.reason ?? null,
        actorUserId: req.currentUser?.id,
      });
    },
  );
}
