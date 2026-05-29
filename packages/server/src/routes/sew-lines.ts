import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import {
  addMachine,
  createSewLine,
  getLineLoad,
  getSewLine,
  listSewLines,
  updateMachineStatus,
} from "../services/sew-line-service.js";

const machineTypeEnum = z.enum([
  "flatlock",
  "coverstitch",
  "single_needle",
  "overlock",
  "bartack",
  "other",
]);
const machineStatusEnum = z.enum(["available", "in_use", "maintenance"]);

const createBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  capacityUnitsPerDay: z.number().int().positive(),
  active: z.boolean().optional(),
});

const machineBody = z.object({
  code: z.string().min(1),
  type: machineTypeEnum,
  status: machineStatusEnum.optional(),
});

const machineStatusBody = z.object({
  status: machineStatusEnum,
});

const loadQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export async function registerSewLineRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth());

  app.get("/", async (req) => listSewLines(req.db));

  app.get("/:id", async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getSewLine(req.db, id);
  });

  app.get("/:id/load", async (req) => {
    const id = Number((req.params as { id: string }).id);
    const q = loadQuery.parse(req.query ?? {});
    return getLineLoad(req.db, id, q.date);
  });

  app.post("/", { preHandler: requireAuth(["admin", "production_staff"]) }, async (req, reply) => {
    const body = createBody.parse(req.body);
    const line = await createSewLine(req.db, { ...body, actorUserId: req.currentUser?.id });
    return reply.status(201).send(line);
  });

  app.post(
    "/:id/machines",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const body = machineBody.parse(req.body);
      const machine = await addMachine(req.db, {
        sewLineId: id,
        ...body,
        actorUserId: req.currentUser?.id,
      });
      return reply.status(201).send(machine);
    },
  );

  app.patch(
    "/:id/machines/:machineId",
    { preHandler: requireAuth(["admin", "production_staff"]) },
    async (req) => {
      const { machineId } = req.params as { id: string; machineId: string };
      const body = machineStatusBody.parse(req.body);
      return updateMachineStatus(req.db, Number(machineId), body.status, req.currentUser?.id);
    },
  );
}
