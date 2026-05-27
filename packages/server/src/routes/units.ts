import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
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

// Registered under /api/units — single-route lookup by serial.
export async function registerUnitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/:serial", async (req) => {
    const { serial } = req.params as { serial: string };
    return getUnit(req.db, serial);
  });
}

// Registered under /api/batches — batch-scoped unit list + verdict POST.
export async function registerBatchUnitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/:batchId/units", async (req) => {
    const { batchId } = req.params as { batchId: string };
    const { verdict } = listQuery.parse(req.query ?? {});
    return listBatchUnits(req.db, Number(batchId), verdict ? { verdict } : undefined);
  });

  app.post(
    "/:batchId/units/:serial/qc",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const { serial } = req.params as { batchId: string; serial: string };
      const body = qcBody.parse(req.body);
      return recordUnitQcVerdict(req.db, {
        unitSerial: serial,
        verdict: body.verdict,
        reason: body.reason ?? null,
        actorUserId: req.currentUser?.id,
      });
    },
  );
}
